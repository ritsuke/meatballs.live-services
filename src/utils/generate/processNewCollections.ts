import cuid from 'cuid'
import slugify from 'slugify'
import axios from 'axios'
import pick from 'lodash-es/pick'
import striptags from 'striptags'

import { TimeSeriesReducers } from '@redis/time-series/dist/commands'

import { redisClient } from '../../redis/clients'
import { collectionRepository } from '../../redis/om/collection'
import { storyRepository } from '../../redis/om/story'
import { commentRepository } from '../../redis/om/comment'
import {
  DATA_SOURCE,
  HTTP_STATUS_CODE,
  MEATBALLS_DB_KEY
} from '../../types/constants'

import { removeSpecialCharacters } from '../../utils'
import { isAxiosError } from '../../utils/api'
import { ALLOWED_TAGS } from '../../utils/'
import { getCollectionsByDate, getUTCTimeFromYMDKey } from '.'
import { UnsplashPhotoData, UNSPLASH_API_ENDPOINTS } from '.'

// TODO: handle potential for overlapping requests (e.g. block)
const processNewCollections = async ({
  dateKey
}: {
  dateKey: string
}): Promise<{
  success: boolean
  error?: {
    message: string
  }
  data?: { notFound: boolean; exists: boolean; benchmark: number }
}> => {
  let success = false,
    errorMessage: string | undefined = undefined,
    exists = false,
    notFound = false

  const benchmarkStartTime = Date.now()

  const [year, month, day] = dateKey
      .split(':')
      .map((datePart) => parseInt(datePart)),
    collectionsStartDateKey = process.env.MEATBALLS_COLLECTIONS_START_DATE_KEY

  if (!collectionsStartDateKey)
    throw 'missing collections start date; check env'

  const startOfRequestedDayInMilliseconds = new Date(
      year,
      month - 1,
      day
    ).setUTCHours(0, 0, 0, 0),
    collectionsStartDateInMilliseconds = getUTCTimeFromYMDKey(
      collectionsStartDateKey
    )

  try {
    // if requested date is before meatballs start date or
    // later than yesterday, return 404
    if (
      startOfRequestedDayInMilliseconds < collectionsStartDateInMilliseconds ||
      startOfRequestedDayInMilliseconds >
        new Date(Date.now()).setUTCHours(23, 59, 59, 9999) - 86400000
    ) {
      notFound = true
      throw new Error(`${HTTP_STATUS_CODE.NOT_FOUND}`)
    }

    const collectionsKeyPrepend = `${year}:${month}:${day}`

    const foundCollections = await getCollectionsByDate({
      repository: collectionRepository,
      date: {
        year,
        month,
        day
      }
    })

    if (foundCollections.length > 0) {
      exists = true
      throw new Error(`${HTTP_STATUS_CODE.CONFLICT}`)
    }

    const endOfRequestedDayInMilliseconds = new Date(
      year,
      month - 1,
      day
    ).setUTCHours(23, 59, 59)

    const foundTimeSeries = await redisClient.ts.mRange(
      startOfRequestedDayInMilliseconds,
      endOfRequestedDayInMilliseconds,
      ['type=weighted', 'compacted=day'],
      {
        GROUPBY: { label: 'story', reducer: TimeSeriesReducers.MAXIMUM }
      }
    )

    // 404
    if (foundTimeSeries.length === 0) {
      notFound = true
      throw new Error(`${HTTP_STATUS_CODE.NOT_FOUND}`)
    }

    // sort by highest value DESC and return 1st 50
    const timeSeriesWithSamples = foundTimeSeries
      .filter((series) => series.samples.length > 0)
      .sort((a, b) => b.samples[0].value - a.samples[0].value)
      .slice(0, 20)

    const findStoriesTransaction = redisClient.multi()

    // prepare transaction calls
    timeSeriesWithSamples.map((series) => {
      const storyId = series.key.replace('story=', `${DATA_SOURCE.HN}:`)

      findStoriesTransaction.graph.query(
        `${MEATBALLS_DB_KEY.GRAPH}`,
        `
      MATCH (s:Story)
      WHERE s.name = "${storyId}"
      return s.name, s.score, s.comment_total, s.created
      `
      )
    })

    const foundStories = await findStoriesTransaction.exec()

    if (foundStories.length === 0) {
      throw new Error(`${HTTP_STATUS_CODE.NOT_FOUND}`)
    }

    const rankedStories = foundStories
      .map((story: any) => {
        const _story: {
            data: Array<[string, number, number, number]>
          } = story,
          [id, score, comment_total, created] = _story.data[0]

        return { id, score, comment_total, created }
      })
      // only use stories within window
      .filter((story) => {
        const storyCreatedInMilliseconds = story.created * 1000

        return (
          storyCreatedInMilliseconds >= startOfRequestedDayInMilliseconds &&
          storyCreatedInMilliseconds <= endOfRequestedDayInMilliseconds
        )
      })
      // bubble comments to top
      .sort((a, b) => {
        if (a.comment_total - a.score < b.comment_total - b.score) {
          return 1
        }

        if (a.comment_total - a.score > b.comment_total - b.score) {
          return -1
        }

        return 0
      })
      // return 1st 9
      .slice(0, 9)

    const newCollections = await Promise.all(
      rankedStories.map(async (story, index) => {
        const slug = cuid.slug()

        try {
          const [collection, storyContent, topCommentsFromGraph] =
              await Promise.all([
                collectionRepository.fetch(`${collectionsKeyPrepend}:${slug}`),
                storyRepository.fetch(story.id),
                redisClient.graph.query(
                  `${MEATBALLS_DB_KEY.GRAPH}`,
                  `
              MATCH (:Story { name: "${story.id}" })-[:PROVOKED]->(topComment)<-[:REACTION_TO*1..]-(childComment)
              WITH topComment, collect(childComment) as childComments
              RETURN topComment.name, topComment.created, SIZE(childComments)
              ORDER BY SIZE(childComments) DESC LIMIT 5
              `
                )
              ]),
            topComment = topCommentsFromGraph.data[0]
              ? await commentRepository.fetch(
                  topCommentsFromGraph.data[0][0] as string
                )
              : null

          collection.year = year
          collection.month = month
          collection.day = day
          collection.title = storyContent.title
          collection.slug = storyContent.title
            ? `${slugify(storyContent.title, {
                strict: true,
                lower: true
              })}-${slug}`
            : null
          collection.top_comment = topComment?.content
            ? striptags(topComment.content, ALLOWED_TAGS)
            : null
          collection.position = index
          collection.comment_total = story.comment_total
          collection.origins = [story.id]

          let photoData: UnsplashPhotoData | undefined = undefined

          if (storyContent.title) {
            photoData = (
              await axios.get<{ results: UnsplashPhotoData[] }>(
                UNSPLASH_API_ENDPOINTS.PHOTO_BY_QUERY(
                  removeSpecialCharacters(storyContent.title)
                ),
                {
                  headers: {
                    Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`
                  }
                }
              )
            ).data.results[0]
          }

          if (photoData) {
            collection.image_username = photoData.user.username
            collection.image_user_url = photoData.user.links.html
            collection.image_source_url = photoData.links.html
            collection.image_url = photoData.urls.raw
            collection.image_blur_hash = photoData.blur_hash
          }

          // who create the story and the stories url (if not a self post)
          const [created_by, address] = (
            await redisClient.graph.query(
              MEATBALLS_DB_KEY.GRAPH,
              `
            MATCH (u:User)-[:CREATED]->(:Story { name: "${story.id}" })
            MATCH (:Story { name: "${story.id}" })-->(url:Url)
            RETURN u.name, url.address
            `
            )
          ).data[0]

          const queryTitle = storyContent.title
            ? removeSpecialCharacters(storyContent.title).replace(/ /g, '|')
            : undefined

          const recommendedStories: { id: string; title: string }[] = []

          if (queryTitle) {
            try {
              const foundDocuments = (
                  await redisClient.ft.search(`Story:index`, queryTitle, {
                    LIMIT: { from: 0, size: 5 }
                  })
                ).documents,
                docTitles = foundDocuments.map(({ value }) => value.title)

              foundDocuments
                .filter(
                  ({ id, value }, index) =>
                    value.title &&
                    !docTitles.includes(value.title, index + 1) &&
                    id.replace('Story:', '') !== story.id &&
                    value.title !== storyContent.title
                )
                .map(({ id, value }) => {
                  if (value.title)
                    recommendedStories.push({
                      id: id.replace('Story:hn:', ''),
                      title: value.title as string
                    })
                })
            } catch (error) {
              console.error('Unable to find recommended stories.')
            }
          }

          // TODO: types
          await Promise.all([
            collectionRepository.save(collection),
            redisClient.set(
              `Collection:${collectionsKeyPrepend}:${slug}:_cache`,
              JSON.stringify({
                story: {
                  id: story.id.replace(`${DATA_SOURCE.HN}:`, ''),
                  created: story.created,
                  content: storyContent.content
                    ? striptags(storyContent.content, ALLOWED_TAGS)
                    : null,
                  created_by,
                  address: address && address !== 'undefined' ? address : null
                },
                comments: await Promise.all(
                  topCommentsFromGraph.data.map(
                    //@ts-ignore
                    async (comment) => {
                      const { entityId, content } =
                        await commentRepository.fetch(comment[0] as string)

                      const user = await redisClient.graph.query(
                        MEATBALLS_DB_KEY.GRAPH,
                        `
                        MATCH (u:User)-[:CREATED]->(:Comment { name: "${entityId}" })
                        RETURN u.name
                        `
                      )

                      return {
                        id: entityId.replace(`${DATA_SOURCE.HN}:`, ''),
                        content: content
                          ? striptags(content, ALLOWED_TAGS)
                          : null,
                        created: comment[1],
                        created_by: user.data[0][0]
                      }
                    }
                  )
                ),
                recommended_stories: recommendedStories
              })
            )
          ])

          return collection
        } catch (error) {
          throw error
        }
      })
    )

    await redisClient.set(
      `Collection:${collectionsKeyPrepend}:_cache`,
      JSON.stringify(
        newCollections.map((collection) => ({
          ...pick(collection, [
            'year',
            'month',
            'day',
            'title',
            'slug',
            'top_comment',
            'comment_total',
            'image_username',
            'image_user_url',
            'image_url',
            'image_source_url',
            'image_blur_hash',
            'position',
            'stories'
          ])
        }))
      )
    )

    success = true
  } catch (error) {
    success = false

    errorMessage = isAxiosError(error)
      ? error.message
      : (error as Error).message

    console.error(
      `[ERROR:NewCollections:${DATA_SOURCE.HN}] dateKey: ${dateKey}, error: ${
        errorMessage || error
      }`
    )
    console.error(error)
  } finally {
    if (errorMessage) {
      return { success, error: { message: errorMessage } }
    }

    return {
      success,
      data: {
        notFound,
        exists,
        benchmark: Date.now() - benchmarkStartTime
      }
    }
  }
}

export default processNewCollections

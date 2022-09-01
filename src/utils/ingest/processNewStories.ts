import axios from 'axios'
import hoursToMilliseconds from 'date-fns/hoursToMilliseconds'

import { DATA_SOURCE, MEATBALLS_DB_KEY } from '../../types/constants'

import { redisClient } from '../../redis/clients'
import { storyRepository } from '../../redis/om/story'

import { isAxiosError } from '../../utils/api'

import { getStoryKeysToSave, SOURCE_REQUEST_HEADERS } from '..'
import {
  getStoryActivityTimeSeriesKey,
  getStoryActivityTimeSeriesSampleValue,
  HackerNewsNativeStoryData
} from '.'
import { HN_API_ENDPOINTS, HN_SOURCE_DOMAIN } from '.'
import { processUserActivity } from '.'
import { TimeSeriesAggregationType, TimeSeriesDuplicatePolicies } from 'redis'

// param(s) describe boundaries
// e.g. process latest 10 stories out of 500 returned from HN
// TODO: abstract when additional data sources are introduced
// benchmark: ~1-2.5s (limit=10)
const processNewStories = async (limit?: number) => {
  const now = Date.now()

  let success = false,
    newStoriesSaved = 0,
    newUsersSaved = 0

  try {
    console.info(
      `[INFO:NewStories:${DATA_SOURCE.HN}] requesting new stories...`
    )

    // get newest story IDs from HN API and trim to limit
    // i.e. we don't always want to process 500 stories
    const newNativeSourceStoriesById = (
      await axios.get<number[] | null>(HN_API_ENDPOINTS.NEW_STORIES_NATIVE, {
        headers: { ...SOURCE_REQUEST_HEADERS }
      })
    ).data

    if (!newNativeSourceStoriesById) {
      throw `[ERROR:NewStories:${DATA_SOURCE.HN}] unable to process new stories from native source; stories missing...`
    }

    const newNativeSourceStoriesByIdTrimmedToLimit = [
        ...newNativeSourceStoriesById.slice(
          0,
          limit || newNativeSourceStoriesById.length
        )
      ],
      newNativeSourceStoriesToSaveToDb = await getStoryKeysToSave(
        newNativeSourceStoriesByIdTrimmedToLimit.map((id) => String(id)),
        'Story'
      )

    // save new stories to db
    await Promise.all(
      newNativeSourceStoriesToSaveToDb.map(async (nativeStoryId) => {
        try {
          console.info(
            `[INFO:NewStories:${DATA_SOURCE.HN}] requesting story data for "${nativeStoryId}"...`
          )

          // get story data and story objects
          const { data: nativeSourceStory } =
            await axios.get<HackerNewsNativeStoryData | null>(
              HN_API_ENDPOINTS.STORY_BY_ID_NATIVE(nativeStoryId),
              { headers: { ...SOURCE_REQUEST_HEADERS } }
            )

          if (!nativeSourceStory) {
            throw `[ERROR:NewStories:${DATA_SOURCE.HN}] unable to process new story from native source story "${nativeStoryId}"; story missing...`
          }

          const {
              by: nativeUserId,
              dead,
              deleted,
              descendants: commentTotal,
              score: storyScore,
              text: content,
              time: created,
              title,
              url
            } = nativeSourceStory,
            newStory = await storyRepository.fetch(
              `${DATA_SOURCE.HN}:${nativeStoryId}`
            )

          // map data to object
          newStory.content = content ?? null
          newStory.title = title ?? null

          // get source user data to relate in graph
          let foundSourceUser

          if (nativeUserId) {
            // user activity processor will create a new user if none exists
            const {
              success,
              data: { updatedUser: sourceUser, isNew: sourceUserIsNew }
            } = await processUserActivity(nativeUserId)

            if (success) {
              foundSourceUser = sourceUser

              if (sourceUser && sourceUserIsNew) {
                newUsersSaved++
              }
            }
          }

          const formattedDomainName = url
            ? new URL(url).hostname.replace('www.', '')
            : HN_SOURCE_DOMAIN

          let storyActivityTimeSeriesTransaction

          if (foundSourceUser?.id) {
            // https://redis.io/docs/manual/transactions/
            // https://redis.io/docs/stack/timeseries/quickstart/
            // https://youtu.be/9JeAu--liMk?t=1737
            storyActivityTimeSeriesTransaction = redisClient.multi()

            const storyActivityTimeSeriesBaseKey =
                getStoryActivityTimeSeriesKey(
                  `${DATA_SOURCE.HN}:${nativeStoryId}`
                ),
              storyActivityTimeSeriesTypeKeyAppend = `${MEATBALLS_DB_KEY.ACTIVITY_TYPE}`,
              storyActivityTimeSeriesBaseOptions = {
                DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.MAX,
                LABELS: {
                  domain: formattedDomainName,
                  story: nativeStoryId,
                  user: foundSourceUser.id,
                  type: MEATBALLS_DB_KEY.ACTIVITY_TYPE
                }
              }

            // not necessary to check the latter if the former exists
            const [
              baseStoryActivityTimesSeriesExists,
              compactedStoryActivityTimeSeriesDayExists,
              compactedStoryActivityTimeSeriesHourExists
            ] = await Promise.all([
              redisClient.exists(
                `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}`
              ),
              redisClient.exists(
                `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}:day`
              ),
              redisClient.exists(
                `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}:hour`
              )
            ])

            if (baseStoryActivityTimesSeriesExists === 0) {
              storyActivityTimeSeriesTransaction.ts.create(
                `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}`,
                {
                  ...storyActivityTimeSeriesBaseOptions
                }
              )
            }

            if (compactedStoryActivityTimeSeriesDayExists === 0) {
              storyActivityTimeSeriesTransaction.ts
                .create(
                  `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}:day`,
                  {
                    ...storyActivityTimeSeriesBaseOptions,
                    LABELS: {
                      ...storyActivityTimeSeriesBaseOptions.LABELS,
                      compacted: 'day'
                    }
                  }
                )
                .ts.createRule(
                  `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}`,
                  `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}:day`,
                  TimeSeriesAggregationType.SUM,
                  hoursToMilliseconds(24)
                )
            }

            if (compactedStoryActivityTimeSeriesHourExists === 0) {
              storyActivityTimeSeriesTransaction.ts
                .create(
                  `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}:hour`,
                  {
                    ...storyActivityTimeSeriesBaseOptions,
                    LABELS: {
                      ...storyActivityTimeSeriesBaseOptions.LABELS,
                      compacted: 'hour'
                    }
                  }
                )
                .ts.createRule(
                  `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}`,
                  `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}:hour`,
                  TimeSeriesAggregationType.SUM,
                  hoursToMilliseconds(1)
                )
            }

            storyActivityTimeSeriesTransaction.ts.add(
              `${storyActivityTimeSeriesBaseKey}:${storyActivityTimeSeriesTypeKeyAppend}`,
              now,
              getStoryActivityTimeSeriesSampleValue({
                score: storyScore || 0,
                commentTotal: commentTotal || 0
              })
            )
          }

          await Promise.all([
            // save initial time series data
            storyActivityTimeSeriesTransaction?.exec(),
            // save object to JSON
            storyRepository.save(newStory),
            // save data to graph
            redisClient.graph.query(
              `${MEATBALLS_DB_KEY.GRAPH}`,
              // https://neo4j.com/docs/cypher-manual/current/
              `
              // create or merge nodes
              // RedisGraph doesn't yet support unique constraints?
              // assume no duplicates based on newStoriesToSaveToDb
              // preference for full variable names due to length of query
              // TODO: check if nodes exists
              ${
                foundSourceUser
                  ? `MATCH (user:User { name: "${foundSourceUser.id}"})`
                  : ''
              }
              
              MERGE (story:Story {
                name: "${DATA_SOURCE.HN}:${nativeStoryId}",
                comment_total: ${commentTotal ?? 0},
                created: ${created}, // seconds
                locked: ${dead ?? false},
                deleted: ${deleted ?? false},
                score: ${storyScore ?? 0}
              })

              MERGE (source:Source {
                name: "${HN_SOURCE_DOMAIN}"
              })

              MERGE (url:Url {
                name: "${formattedDomainName}",
                address: "${url}"
              })

              // create or merge relationships
              // TODO: check if relationships exist
              ${
                foundSourceUser
                  ? `
                  MERGE (user)-[:CREATED]->(story)-[:CREATED_BY]->(user)
                  MERGE (user)-[:USER_OF]->(source)-[:USED_BY]->(user)
                  `
                  : ''
              }
              MERGE (source)-[:HOSTS]->(story)-[:HOSTED_BY]->(source)
              MERGE (story)-[:POINTS_TO]->(url)-[:COMES_FROM]->(story)
              `
            )
          ])

          console.info(
            `[INFO:NewStories:${DATA_SOURCE.HN}] saved new story "${nativeStoryId}" to DB...`
          )
        } catch (error) {
          console.error(error)

          throw error
        }
      })
    )

    newStoriesSaved = newNativeSourceStoriesToSaveToDb.length

    success = true
  } catch (error) {
    let errorMessage = isAxiosError(error)
      ? error.message
      : (error as Error).message

    console.error(
      `[ERROR:NewStories:${DATA_SOURCE.HN}] limit: ${limit}, error: ${errorMessage}`
    )
    console.error(error)

    throw errorMessage
  } finally {
    console.info(
      `[INFO:NewStories:${DATA_SOURCE.HN}] saved ${newStoriesSaved} new stories to DB...`
    )
    console.info(
      `[INFO:NewStories:${DATA_SOURCE.HN}] saved ${newUsersSaved} new users to DB...`
    )

    return {
      success,
      data: {
        newStoriesSaved,
        newUsersSaved
      }
    }
  }
}

export default processNewStories

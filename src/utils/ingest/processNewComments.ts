import axios from 'axios'
import striptags from 'striptags'

import {
  DATA_SOURCE,
  HTTP_STATUS_CODE,
  MEATBALLS_DB_KEY,
  MEATBALLS_CHANNEL_KEY
} from '../../types/constants'

import { isAxiosError } from '../../utils/api'

import { redisClient } from '../../redis/clients'
import { commentRepository } from '../../redis/om/comment'

import {
  ALLOWED_TAGS,
  getCommentsToSave,
  SOURCE_REQUEST_HEADERS,
  SOURCE_USER_AGENT
} from '..'
import type { HackerNewsNativeCommentData } from '.'
import { HN_API_ENDPOINTS } from '.'
import { processUserActivity, flattenComments } from '.'

const processNewComments = async (nativeSourceStoryId: string) => {
  let success = false

  try {
    console.info(
      `[INFO:NewComments:${DATA_SOURCE.HN}] requesting comments for native source story "${nativeSourceStoryId}" with user agent "${SOURCE_USER_AGENT}"...`
    )

    const { data: algoliaSourceStory } = await axios.get<{
      children: Array<HackerNewsNativeCommentData>
    } | null>(HN_API_ENDPOINTS.STORY_BY_ID_ALGOLIA(nativeSourceStoryId), {
      headers: { ...SOURCE_REQUEST_HEADERS }
    })

    if (!algoliaSourceStory) {
      throw `[ERROR:NewComments:${DATA_SOURCE.HN}] unable to process new comments from algolia from native source story "${nativeSourceStoryId}"; story missing...`
    }

    const { children: newComments } = algoliaSourceStory

    const newCommentsToSaveToDb = await getCommentsToSave(
      flattenComments(newComments),
      'Comment'
    )

    const commentNodesTransaction = redisClient.multi(),
      commentRelationshipsTransaction = redisClient.multi()

    // save comment JSON and add nodes and relationships to respective transactions
    await Promise.all(
      newCommentsToSaveToDb.map(async (comment) => {
        if (!comment.id)
          throw `[ERROR:NewComments:${DATA_SOURCE.HN}] unable to get key to save; missing comment ID...`

        console.info(
          `[INFO:NewComments:${DATA_SOURCE.HN}] requesting comment data for "${comment.id}"...`
        )

        const {
            author: user,
            created_at_i: created,
            deleted,
            parent_id,
            text: content
          } = comment,
          newCommentId = `${DATA_SOURCE.HN}:${comment.id}`,
          newComment = await commentRepository.fetch(newCommentId)

        if (user === undefined) {
          throw `[ERROR:NewComments:${DATA_SOURCE.HN}] unable to process user activity; missing user ID...`
        }

        // save or update user
        const {
          data: { updatedUser }
        } = await processUserActivity(user)

        newComment.content = content ?? null

        await Promise.all([
          redisClient.publish(
            MEATBALLS_CHANNEL_KEY.COMMENT_STREAM,
            JSON.stringify({
              id: comment.id,
              user,
              created,
              content: content ? striptags(content, ALLOWED_TAGS) : null
            })
          ),
          // save JSON
          commentRepository.save(newComment)
        ])

        // add query to nodes transaction
        commentNodesTransaction.graph.query(
          `${MEATBALLS_DB_KEY.GRAPH}`,
          `
          MERGE (comment:Comment {
            name: "${newCommentId}",
            created: ${created}, // seconds
            deleted: ${deleted ?? false}
          })

          RETURN comment.name
          `
        )

        // add query to relationships query
        commentRelationshipsTransaction.graph.query(
          `${MEATBALLS_DB_KEY.GRAPH}`,
          `
          MATCH (parent { name: "${DATA_SOURCE.HN}:${parent_id}" })
          MATCH (user:User { name: "${user}" })
          MATCH (comment:Comment { name: "${newCommentId}" })

          MERGE (parent)-[:PROVOKED]->(comment)-[:REACTION_TO]->(parent)
          MERGE (user)-[:CREATED]->(comment)-[:CREATED_BY]->(user)

          RETURN parent.name, user.name
          `
        )
      })
    )

    // save nodes to graph
    await commentNodesTransaction.exec()
    // then save relationships
    await commentRelationshipsTransaction.exec()

    success = true
  } catch (error) {
    let errorMessage = isAxiosError(error)
      ? error.message
      : (error as Error).message

    console.error(
      `[ERROR:NewComments:${DATA_SOURCE.HN}] nativeSourceStoryId: ${nativeSourceStoryId}, error: ${errorMessage}`
    )

    if (
      isAxiosError(error) &&
      error.response?.status === HTTP_STATUS_CODE.NOT_FOUND
    ) {
      console.warn(
        `[WARN:NewComments:${DATA_SOURCE.HN}] story "${nativeSourceStoryId}" has not propagated or is locked or deleted; skipping comments...`
      )

      return
    }

    console.error(error)

    throw errorMessage
  } finally {
    return {
      success,
      data: {}
    }
  }
}

export default processNewComments

import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifySchema
} from 'fastify'
import { DATA_SOURCE, HTTP_STATUS_CODE } from '../../types/constants'
import { processStoryActivity } from '../../utils/ingest'

interface IngestStoryActivityRouteQuery {
  dataSource: string
  start: number
  end: number
  commentWeight: number
  falloff: number
  score?: number
  commentTotal?: number
}

interface IngestStoryActivityRouteResponse {
  success: boolean
  error?: {
    message: string
  }
  data?: {
    stories_updated_with_latest_score: number
    stories_updated_with_latest_comment_total: number
  }
}

const IngestStoryActivityRouteSchema: FastifySchema = {
  headers: {
    type: 'object',
    required: ['Authorization'],
    properties: {
      authorization: { type: 'string' }
    }
  },
  querystring: {
    type: 'object',
    required: ['dataSource', 'start', 'end', 'commentWeight', 'falloff'],
    properties: {
      dataSource: { type: 'string' },
      start: { type: 'number' },
      end: { type: 'number' },
      commentWeight: { type: 'number' },
      falloff: { type: 'number' },
      score: { type: 'number' },
      commentTotal: { type: 'number' }
    }
  },
  response: {
    200: {
      type: 'object',
      required: ['success'],
      properties: {
        success: { type: 'boolean' },
        error: {
          message: { type: 'string' }
        },
        data: {
          stories_updated_with_latest_score: { type: 'number' },
          stories_updated_with_latest_comment_total: { type: 'number' }
        }
      }
    }
  }
}

const IngestStoryActivityRoute: FastifyPluginCallback = (
  app: FastifyInstance,
  _: any,
  next: any
) => {
  app.post<{
    Querystring: IngestStoryActivityRouteQuery
    Reply: IngestStoryActivityRouteResponse
  }>(
    '/ingest/story-activity',
    { schema: IngestStoryActivityRouteSchema },
    async (
      {
        query: {
          dataSource,
          start,
          end,
          commentWeight,
          falloff,
          score,
          commentTotal
        }
      },
      res
    ) => {
      let storiesUpdatedWithLatestScore = 0,
        storiesUpdatedWithLatestCommentTotal = 0

      try {
        switch (dataSource) {
          case DATA_SOURCE.HN:
            const { data } = await processStoryActivity({
              start,
              end,
              commentWeight,
              falloff,
              score,
              commentTotal
            })

            storiesUpdatedWithLatestScore = data.storiesUpdatedWithLatestScore
            storiesUpdatedWithLatestCommentTotal =
              data.storiesUpdatedWithLatestCommentTotal
            break
          default:
            return res.status(HTTP_STATUS_CODE.BAD_REQUEST).send({
              success: false,
              error: {
                message: `data source '${dataSource}' is not supported...`
              }
            })
        }
      } catch (error) {
        console.error(error)
        return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).send({
          success: false,
          error: { message: (error as Error).message }
        })
      }

      return res.status(200).send({
        success: true,
        data: {
          stories_updated_with_latest_score: storiesUpdatedWithLatestScore,
          stories_updated_with_latest_comment_total:
            storiesUpdatedWithLatestCommentTotal
        }
      })
    }
  )

  next()
}

export default IngestStoryActivityRoute

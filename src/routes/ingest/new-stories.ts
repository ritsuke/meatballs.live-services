import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifySchema
} from 'fastify'

import { DATA_SOURCE, HTTP_STATUS_CODE } from '../../types/constants'

import { processNewStories } from '../../utils/ingest'

interface IngestNewStoriesRouteQuery {
  dataSource: string
  limit: number
}

interface IngestNewStoriesRouteResponse {
  success: boolean
  error?: {
    message: string
  }
  data?: {
    new_stories_saved: number
    new_users_saved: number
  }
}

const IngestNewStoriesRouteSchema: FastifySchema = {
  headers: {
    type: 'object',
    required: ['Authorization'],
    properties: {
      authorization: { type: 'string' }
    }
  },
  querystring: {
    type: 'object',
    required: ['dataSource', 'limit'],
    properties: {
      dataSource: { type: 'string' },
      limit: { type: 'integer' }
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
          new_stories_saved: { type: 'number' },
          new_users_saved: { type: 'number' }
        }
      }
    }
  }
}

const IngestNewStoriesRoute: FastifyPluginCallback = (
  app: FastifyInstance,
  _,
  next
) => {
  app.post<{
    Querystring: IngestNewStoriesRouteQuery
    Reply: IngestNewStoriesRouteResponse
  }>(
    '/ingest/new-stories',
    { schema: IngestNewStoriesRouteSchema },
    async ({ query: { dataSource, limit } }, res) => {
      let newStoriesSaved = 0,
        newUsersSaved = 0

      try {
        switch (dataSource) {
          case DATA_SOURCE.HN:
            const { data } = await processNewStories(limit)

            newStoriesSaved = data.newStoriesSaved
            newUsersSaved = data.newUsersSaved
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

      return res.status(HTTP_STATUS_CODE.OK).send({
        success: true,
        data: {
          new_stories_saved: newStoriesSaved,
          new_users_saved: newUsersSaved
        }
      })
    }
  )

  next()
}

export default IngestNewStoriesRoute

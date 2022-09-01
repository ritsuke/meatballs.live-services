import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifySchema
} from 'fastify'

import { DATA_SOURCE, HTTP_STATUS_CODE } from '../../types/constants'
import processNewCollections from '../../utils/generate/processNewCollections'

import { processNewStories } from '../../utils/ingest'

interface GenerateNewCollectionsRouteQuery {
  dateKey: string
}

interface GenerateNewCollectionsRouteResponse {
  success: boolean
  error?: {
    message: string
  }
  data?: {
    not_found: boolean
    exists: boolean
    benchmark: number
  }
}

const GenerateNewCollectionsRouteSchema: FastifySchema = {
  headers: {
    type: 'object',
    required: ['Authorization'],
    properties: {
      authorization: { type: 'string' }
    }
  },
  querystring: {
    type: 'object',
    required: ['dateKey'],
    properties: {
      dateKey: { type: 'string' }
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
          not_found: { type: 'boolean' },
          exists: { type: 'boolean' },
          benchmark: { type: 'number' }
        }
      }
    }
  }
}

const GenerateNewCollectionsRoute: FastifyPluginCallback = (
  app: FastifyInstance,
  _,
  next
) => {
  app.post<{
    Querystring: GenerateNewCollectionsRouteQuery
    Reply: GenerateNewCollectionsRouteResponse
  }>(
    '/generate/new-collections',
    { schema: GenerateNewCollectionsRouteSchema },
    async ({ query: { dateKey } }, res) => {
      try {
        const { success, error, data } = await processNewCollections({
          dateKey
        })

        if (!data || error) {
          return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).send({
            success: false,
            error: {
              message: error?.message || 'unknown error'
            }
          })
        }

        const { exists, notFound, benchmark } = data

        return res.status(HTTP_STATUS_CODE.OK).send({
          success,
          data: {
            exists,
            not_found: notFound,
            benchmark
          }
        })
      } catch (error) {
        console.error(error)
        return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).send({
          success: false,
          error: { message: (error as Error).message }
        })
      }
    }
  )

  next()
}

export default GenerateNewCollectionsRoute

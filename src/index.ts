import 'dotenv/config'

import fastify from 'fastify'
import cors from '@fastify/cors'
import bearerAuth from '@fastify/bearer-auth'

import {
  routeOptions,
  ingestNewStoriesRoute,
  ingestStoryActivityRoute,
  generateNewCollectionsRoute
} from './routes'

if (!process.env.PORT) throw 'missing port; check env'
if (!process.env.INGEST_API_KEY) throw 'missing ingest API key; check env'

const PORT = process.env.PORT,
  INGEST_API_KEY = process.env.INGEST_API_KEY

const api = fastify()

api
  .register(cors, { origin: [`http://localhost:${PORT}`] })
  .register(bearerAuth, {
    keys: new Set([INGEST_API_KEY]),
    auth: (key, req) => {
      if (req.url.includes('documentation')) return true
      if (key !== INGEST_API_KEY) return false

      return true
    }
  })

// routes
api
  .register(ingestNewStoriesRoute, routeOptions)
  .register(ingestStoryActivityRoute, routeOptions)
  .register(generateNewCollectionsRoute, routeOptions)

api.ready(async (error) => {
  if (error) throw error

  console.info(
    `Started meatballs.live-ingest-services (hyperion) on port: ${PORT}`
  )
})

api.listen({
  host: '0.0.0.0',
  port: parseInt(PORT)
})

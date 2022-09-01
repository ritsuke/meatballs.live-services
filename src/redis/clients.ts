import { createClient } from 'redis'
import { Client } from 'redis-om'

export type RedisClient = ReturnType<typeof createClient>

if (!process.env.REDIS_DB_URL) throw 'missing redis DB url; check env'

const client = createClient({ url: process.env.REDIS_DB_URL })

await client.connect()

export const redisClient = client
export const redisOmClient = await new Client().use(client)

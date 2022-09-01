import { Entity, Schema } from 'redis-om'

import { redisOmClient } from '../clients'

export interface Collection {
  year: number
  month: number
  day: number
  title: string | null
  slug: string | null
  top_comment: string | null
  comment_total: number
  image_username: string | null
  image_user_url: string | null
  image_url: string | null
  image_source_url: string | null
  image_blur_hash: string | null
  position: number // collection rank 0..*
  origins: string[] // origin stories
}

export class Collection extends Entity {}

const collectionSchema = new Schema(Collection, {
  year: { type: 'number' },
  month: { type: 'number' },
  day: { type: 'number' },
  title: { type: 'text' },
  slug: { type: 'string' },
  top_comment: { type: 'text' },
  comment_total: { type: 'number' },
  image_username: { type: 'string' },
  image_user_url: { type: 'string' },
  image_url: { type: 'string' },
  image_source_url: { type: 'string' },
  image_blur_hash: { type: 'string' },
  position: { type: 'number', sortable: true },
  origins: { type: 'string[]' }
})

export const collectionRepository =
  redisOmClient.fetchRepository(collectionSchema)

await collectionRepository.createIndex()

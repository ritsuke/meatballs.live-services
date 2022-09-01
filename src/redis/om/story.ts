import { Entity, Schema } from 'redis-om'

import { redisOmClient } from '../clients'

export interface Story {
  content: string | null
  title: string | null
}

export class Story extends Entity {}

const storySchema = new Schema(Story, {
  content: { type: 'text' },
  title: { type: 'text' }
})

export const storyRepository = redisOmClient.fetchRepository(storySchema)

await storyRepository.createIndex()

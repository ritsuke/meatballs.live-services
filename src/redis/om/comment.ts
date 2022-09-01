import { Entity, Schema } from 'redis-om'

import { redisOmClient } from '../clients'

export interface Comment {
  content: string | null
}

export class Comment extends Entity {}

const commentSchema = new Schema(Comment, {
  content: { type: 'text' }
})

export const commentRepository = redisOmClient.fetchRepository(commentSchema)

await commentRepository.createIndex()

import { Entity, Schema } from 'redis-om'

import { redisOmClient } from '../clients'

export interface User {
  about: string | null
}

export class User extends Entity {}

const userSchema = new Schema(User, {
  about: { type: 'text' }
})

export const userRepository = redisOmClient.fetchRepository(userSchema)

await userRepository.createIndex()

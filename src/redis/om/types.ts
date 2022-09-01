import { Entity, Repository } from 'redis-om'

export type MeatballObjectType = 'Story' | 'User' | 'Comment'

export type OmObjectReturnType<T extends Entity> = {
  repository?: Repository<T>
  closeRepository: () => Promise<void>
}

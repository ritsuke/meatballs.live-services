import type { AxiosRequestHeaders } from 'axios'

import { redisClient } from '../redis/clients'

import type { MeatballObjectType } from '../redis/om/types'
import { DATA_SOURCE } from '../types/constants'
import type { HackerNewsNativeCommentData } from './ingest'

export const getStoryKeysToSave = async (
  idsToCheck: string[],
  objectType: MeatballObjectType
) => {
  // create transaction to check for stories that don't exist
  const checkExistingKeyTransaction = redisClient.multi(),
    keysToSave: string[] = []

  // add commands to transaction
  idsToCheck.map((id) => {
    checkExistingKeyTransaction.exists(`${objectType}:${DATA_SOURCE.HN}:${id}`)
  })

  // execute transaction
  // returns number[] with values 0 (false), 1 (true)
  const checkExistingStoriesTransactionResult =
    await checkExistingKeyTransaction.exec()

  // if key doesn't exist, push ID to array
  checkExistingStoriesTransactionResult.map((exists, index) => {
    if (exists === 0) keysToSave.push(idsToCheck[index])
  })

  return keysToSave
}

export const getCommentsToSave = async (
  objectsToCheck: HackerNewsNativeCommentData[],
  objectType: MeatballObjectType
) => {
  // create transaction to check for stories that don't exist
  const checkExistingKeyTransaction = redisClient.multi(),
    objectsToSave: HackerNewsNativeCommentData[] = []

  // add commands to transaction
  objectsToCheck.map(({ id }) => {
    id &&
      checkExistingKeyTransaction.exists(
        `${objectType}:${DATA_SOURCE.HN}:${id}`
      )
  })

  // execute transaction
  // returns number[] with values 0 (false), 1 (true)
  const checkExistingCommentsTransactionResult =
    await checkExistingKeyTransaction.exec()

  // if key doesn't exist, push object to array
  checkExistingCommentsTransactionResult.map((exists, index) => {
    if (exists === 0) objectsToSave.push(objectsToCheck[index])
  })

  return objectsToSave
}

export const SOURCE_USER_AGENT = process.env.SOURCE_USER_AGENT
if (!SOURCE_USER_AGENT)
  throw 'environment variable SOURCE_USER_AGENT not set...'

// let 3rd party data provider know who we are
export const SOURCE_REQUEST_HEADERS: AxiosRequestHeaders = {
  'User-Agent': SOURCE_USER_AGENT || 'unknown'
}

export const ALLOWED_TAGS = ['p', 'a', 'b', 'strong', 'i', 'em', 'code', 'pre']

export const removeSpecialCharacters = (value: string) =>
  value.replace(/[^a-zA-Z0-9 ]/g, '')

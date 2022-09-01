// NOTE: it shouldn't be necessary to call this processor directly
// user activity processor is higher order

import axios from 'axios'

import { DATA_SOURCE, MEATBALLS_DB_KEY } from '../../types/constants'

import { redisClient } from '../../redis/clients'
import { userRepository } from '../../redis/om/user'

import { isAxiosError } from '../../utils/api'

import { SOURCE_REQUEST_HEADERS } from '..'
import type { HackerNewsNativeUserData } from '.'
import { HN_API_ENDPOINTS } from '.'

const processNewUser = async (nativeSourceUserId: string) => {
  let success = false,
    nativeSourceUser,
    isNew = true

  try {
    console.info(
      `[INFO:NewUser:${DATA_SOURCE.HN}] requesting user data for "${nativeSourceUserId}"...`
    )

    nativeSourceUser = (
      await axios.get<HackerNewsNativeUserData | null>(
        HN_API_ENDPOINTS.USER_BY_ID_NATIVE(nativeSourceUserId),
        { headers: { ...SOURCE_REQUEST_HEADERS } }
      )
    ).data

    if (!nativeSourceUser) {
      throw `[ERROR:NewUser:${DATA_SOURCE.HN}] unable to process new user "${nativeSourceUserId}" from native source; user missing...`
    }

    if (
      (await redisClient.exists(
        `User:${DATA_SOURCE.HN}:${nativeSourceUser.id}`
      )) === 1
    ) {
      isNew = false
    }

    // save new user data
    if (
      nativeSourceUser &&
      (await redisClient.exists(
        `User:${DATA_SOURCE.HN}:${nativeSourceUser.id}`
      )) === 0
    ) {
      const newUser = await userRepository.fetch(
        `${DATA_SOURCE.HN}:${nativeSourceUser.id}`
      )

      newUser.about = nativeSourceUser.about ?? null

      await Promise.all([
        userRepository.save(newUser),
        redisClient.graph.query(
          `${MEATBALLS_DB_KEY.GRAPH}`,
          `MERGE (user:User { name: "${nativeSourceUser.id}", created: ${nativeSourceUser.created}, score: ${nativeSourceUser.karma} })`
        )
      ])

      console.info(
        `[INFO:NewUser:${DATA_SOURCE.HN}] saved new user "${nativeSourceUser.id}" to DB...`
      )
    }

    success = true
  } catch (error) {
    let errorMessage = isAxiosError(error)
      ? error.message
      : (error as Error).message

    console.error(
      `[ERROR:NewUser:${DATA_SOURCE.HN}] nativeSourceUserId: ${nativeSourceUserId}, error: ${errorMessage}`
    )
    console.error(error)

    throw errorMessage
  } finally {
    return {
      success,
      data: {
        sourceUser: nativeSourceUser,
        // user already exists in database
        // and may require an update
        // see user activity processor
        isNew
      }
    }
  }
}

export default processNewUser

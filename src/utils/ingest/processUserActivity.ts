import { DATA_SOURCE, MEATBALLS_DB_KEY } from '../../types/constants'

import { redisClient } from '../../redis/clients'

import { processNewUser } from '.'

const processUserActivity = async (nativeSourceUserId: string) => {
  let success = false,
    updatedUser,
    isNew = false

  try {
    const {
      data: { sourceUser: nativeSourceUser, isNew: _isNew }
    } = await processNewUser(nativeSourceUserId)

    isNew = _isNew

    // if user exists, look up in graph and update score if necessary
    // otherwise, assume the user is new w/ fresh data and skip
    if (nativeSourceUser && !isNew) {
      // sourceUser is latest data from source
      // get data from DB and compare
      const existingUser = (
        await redisClient.graph.query(
          `${MEATBALLS_DB_KEY.GRAPH}`,
          `
        MATCH (u:User { name: "${nativeSourceUserId}" })
        RETURN u.score
        `
        )
      ).data

      if (nativeSourceUser.karma !== existingUser[0][0]) {
        console.info(
          `[INFO:UserActivity:${DATA_SOURCE.HN}] updating existing user "${nativeSourceUserId}"...`
        )

        await redisClient.graph.query(
          `${MEATBALLS_DB_KEY.GRAPH}`,
          `
          MERGE (u:User { name: "${nativeSourceUserId}"})
          ON MATCH
            SET
              u.score = ${nativeSourceUser.karma}
          `
        )
      }
    }

    // user is new w/ fresh data
    if (isNew) {
      updatedUser = nativeSourceUser
    }

    success = true
  } catch (error) {
    const errorMessage = (error as Error).message

    console.error(
      `[ERROR:NewUser:${DATA_SOURCE.HN}] nativeSourceUserId: ${nativeSourceUserId}, error: ${errorMessage}`
    )
    console.error(error)

    throw errorMessage
  } finally {
    return { success, data: { updatedUser, isNew } }
  }
}

export default processUserActivity

import { MEATBALLS_DB_KEY } from '../../types/constants'

import processNewStories from './processNewStories'
import processStoryActivity from './processStoryActivity'
import processNewUser from './processNewUser'
import processUserActivity from './processUserActivity'
import processNewComments from './processNewComments'

// assume that any props can change by the source provider
// hence are optional and must be checked
export interface HackerNewsNativeStoryData {
  by?: string
  dead?: boolean // locked
  deleted?: boolean
  descendants?: number
  id?: string
  score?: number
  text?: string
  time: number
  title?: string
  url?: string
}

export interface HackerNewsNativeUserData {
  about?: string
  created?: number
  id?: string
  karma?: number
}

export interface HackerNewsNativeCommentData {
  author?: string
  children?: Array<HackerNewsNativeCommentData>
  created_at_i?: number
  deleted?: boolean
  id?: string
  parent_id?: string
  story_id?: string
  text?: string
}

const HN_API_ENDPOINTS = {
    NEW_STORIES_NATIVE: 'https://hacker-news.firebaseio.com/v0/newstories.json',
    STORY_BY_ID_NATIVE: (id: string) =>
      `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
    USER_BY_ID_NATIVE: (id: string) =>
      `https://hacker-news.firebaseio.com/v0/user/${id}.json`,
    STORY_BY_ID_ALGOLIA: (id: string) =>
      `https://hn.algolia.com/api/v1/items/${id}`
  },
  HN_SOURCE_DOMAIN = 'news.ycombinator.com',
  HN_STORY_URL = (id: string) => `https://news.ycombinator.com/item?id=${id}`,
  HN_USER_URL = (id: string) => `https://news.ycombinator.com/user?id=${id}`

const flattenComments = (
  comments: Array<HackerNewsNativeCommentData>
): Array<HackerNewsNativeCommentData> =>
  comments.flatMap((comment) =>
    comment.children && comment.children.length > 0
      ? [comment, ...flattenComments(comment.children)]
      : comment
  )

const getStoryActivityTimeSeriesKey = (
  storyId: string,
  withType: boolean = false
) =>
  `Story:${storyId}:${MEATBALLS_DB_KEY.ACTIVITY}${
    withType ? `:${MEATBALLS_DB_KEY.ACTIVITY_TYPE}` : ''
  }`

const getStoryActivityTimeSeriesSampleValue = ({
  score,
  commentTotal,
  commentWeight,
  falloff
}: {
  score: number
  commentTotal: number
  commentWeight?: number // 1-100x
  falloff?: number // 1-100%
}) => {
  console.info(
    `[INFO:getStoryActivityTimeSeriesSampleValue] score: ${score}, commentTotal: ${commentTotal}, commentWeight: ${commentWeight}, falloff: ${falloff}`
  )

  const weightedValue = Math.round(
    (score + commentTotal) *
      (commentWeight !== undefined ? commentWeight : 1) *
      (falloff !== undefined ? (100 - falloff) / 100 : 1)
  )

  console.info(
    `[INFO:getStoryActivityTimeSeriesSampleValue] weighted value: ${weightedValue}`
  )

  return weightedValue
}

export {
  HN_API_ENDPOINTS,
  HN_SOURCE_DOMAIN,
  HN_STORY_URL,
  HN_USER_URL,
  flattenComments,
  getStoryActivityTimeSeriesKey,
  getStoryActivityTimeSeriesSampleValue,
  processNewStories,
  processStoryActivity,
  processNewUser,
  processUserActivity,
  processNewComments
}

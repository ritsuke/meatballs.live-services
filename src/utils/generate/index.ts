import type { ParsedUrlQuery } from 'querystring'
import { Repository } from 'redis-om'

import { Collection } from '../../redis/om/collection'

export type CollectionDate = {
  year: number
  month: number
  day: number
}

export const parseCollectionParamsFromParsedUrlQuery = (
  params: ParsedUrlQuery
) => ({
  year: typeof params.year === 'string' ? parseInt(params.year) : undefined,
  month: typeof params.month === 'string' ? parseInt(params.month) : undefined,
  day: typeof params.day === 'string' ? parseInt(params.day) : undefined,
  collectionId: typeof params.cid === 'string' ? params.cid : undefined
})

export const getUTCTimeFromYMDKey = (key: string, end?: boolean) => {
  const timeParts = key.split(':'),
    [year, month, day] = timeParts.map((part) => parseInt(part)),
    baseDate = new Date(year, month - 1, day)

  if (end) {
    return baseDate.setUTCHours(23, 59, 59, 9999)
  }

  return baseDate.setUTCHours(0, 0, 0, 0)
}

export const getYMDKeyFromUTCTime = (time: number) => {
  const date = new Date(time)

  return `${date.getUTCFullYear()}:${
    date.getUTCMonth() + 1
  }:${date.getUTCDate()}`
}

export const getTimePartsFromYMDKey = (key: string) => {
  const [year, month, day] = key.split(':')

  return { year: parseInt(year), month: parseInt(month), day: parseInt(day) }
}

export const getCollectionsUrlFromYMDKey = (key: string) =>
  `/c/${key.replace(/:/g, '/')}/`

export const getYMDKeyFromTimeParts = (
  year: number,
  month: number,
  day: number
) => `${year}:${month}:${day}`

export const getCollectionsByDate = async ({
  repository,
  date: { year, month, day }
}: {
  repository: Repository<Collection>
  date: CollectionDate
}) =>
  await repository
    .search()
    .where('year')
    .eq(year)
    .and('month')
    .eq(month)
    .and('day')
    .eq(day)
    .sortBy('position')
    .return.all()

export type UnsplashPhotoData = {
  blur_hash: string
  urls: {
    raw: string
  }
  links: {
    html: string
  }
  user: {
    username: string
    links: {
      html: string
    }
  }
}

export const UNSPLASH_API_ENDPOINTS = {
  PHOTO_BY_QUERY: (query: string) =>
    `https://api.unsplash.com/search/photos?query="${query}"&per_page=1`
}

import axios from 'axios'

import type { AxiosError } from 'axios'

// https://github.com/axios/axios/issues/3612#issuecomment-1198490390
export const isAxiosError = <ResponseType>(
  error: unknown
): error is AxiosError<ResponseType> => axios.isAxiosError(error)

// TODO: vercel wraps values with double quotes,
// but thunder client includes as part of value; report
export const preprocessAuthHeader = (value: unknown) =>
  typeof value === 'string'
    ? value.replace(/"/g, '').replace('Bearer ', '')
    : undefined

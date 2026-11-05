// The typed api client: routes and answers come from the api's own types, never written by hand.
import type { AppType } from '@nyxeron/api'
import { hc } from 'hono/client'

export const api = hc<AppType>('/').api

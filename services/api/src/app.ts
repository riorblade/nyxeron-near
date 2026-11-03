import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Identity } from './auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { AppError } from './http.ts'
import { playerRoutes } from './players.ts'
import { type Quotes, quoteRoutes } from './quotes.ts'

export type Deps = { cfg: Config; db: Db; identity: Identity; quotes: Quotes }

export function createApp(deps: Deps) {
  const app = new Hono()
    .basePath('/api')
    .onError((err, c) => {
      if (err instanceof AppError) return c.json({ error: err.code }, err.status)
      if (err instanceof HTTPException) return err.getResponse()
      console.error(err)
      return c.json({ error: 'internal' }, 500)
    })
    .get('/health', (c) => c.json({ ok: true, network: deps.cfg.NEAR_NETWORK }))
    .route('/quotes', quoteRoutes(deps.quotes))
    .route('/me', playerRoutes(deps))
  return app
}

// The web imports this type for a typed client: hc<AppType>('/') from 'hono/client'.
export type AppType = ReturnType<typeof createApp>

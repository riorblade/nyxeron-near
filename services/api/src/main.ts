import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'

const cfg = loadConfig()
mkdirSync(cfg.DATA_DIR, { recursive: true })
const db = openDb(join(cfg.DATA_DIR, 'nyxeron.db'))
const app = createApp({ cfg, db })

const server = serve({ fetch: app.fetch, port: cfg.PORT }, (info) =>
  console.log(`api on http://localhost:${info.port}/api/health (${cfg.NEAR_NETWORK})`),
)

// Finish in-flight requests, then close the database cleanly.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      db.close()
      process.exit(0)
    })
  })
}

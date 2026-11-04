import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { privyIdentity } from './auth.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { marketQuotes } from './quotes.ts'
import { robinhoodReader, verifyMenu } from './robinhood.ts'

const cfg = loadConfig()
mkdirSync(cfg.DATA_DIR, { recursive: true })
const db = openDb(join(cfg.DATA_DIR, 'nyxeron.db'))
const identity = privyIdentity(cfg.PRIVY_APP_ID, cfg.PRIVY_APP_SECRET)
// Every pinned stock is checked on Robinhood Chain before it can be priced or sold.
const menu = await verifyMenu(robinhoodReader())
if (menu.failed.length) console.warn('stocks failing the on-chain check, left off the menu:', menu.failed.join(', '))
if (!menu.ok.length) throw new Error('no stock passed the on-chain check')
const app = createApp({ cfg, db, identity, quotes: marketQuotes({ allowed: new Set(menu.ok) }) })

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

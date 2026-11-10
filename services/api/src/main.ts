import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { privyIdentity } from './auth.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { oneClick } from './intents.ts'
import { nearOwnerChain, nearRelayer } from './near.ts'
import { marketQuotes } from './quotes.ts'
import { robinhoodReader, verifyMenu } from './robinhood.ts'
import { buySharesFor, settlement } from './settlement.ts'

const cfg = loadConfig()
mkdirSync(cfg.DATA_DIR, { recursive: true })
const db = openDb(join(cfg.DATA_DIR, 'nyxeron.db'))
const identity = privyIdentity(cfg.PRIVY_APP_ID, cfg.PRIVY_APP_SECRET)
// Every pinned stock is checked on Robinhood Chain before it can be priced or sold.
const menu = await verifyMenu(robinhoodReader())
if (menu.failed.length) console.warn('stocks failing the on-chain check, left off the menu:', menu.failed.join(', '))
if (!menu.ok.length) throw new Error('no stock passed the on-chain check')
const relayer = nearRelayer(cfg)
if (!relayer) console.warn('no relayer key: /api/relay and /api/onboard answer 503 relayer_off')
// Add money / Cash out. Testnet answers dry quotes only (1Click has no testnet).
const oneclick = oneClick({ url: cfg.ONECLICK_URL, jwt: cfg.ONECLICK_JWT })
const app = createApp({ cfg, db, identity, quotes: marketQuotes({ allowed: new Set(menu.ok) }), relayer, oneclick })

// After each party: release its wholesale, back the owed units, settle them to the guests (one tx at a time).
const owner = nearOwnerChain(cfg)
// One job for the process: its guard keeps a slow tick (a mainnet buy takes seconds) from overlapping the next one.
const job = owner ? settlement({ db, chain: owner, buyShares: buySharesFor(cfg), log: console.log }) : undefined
const settleTimer = job
  ? setInterval(() => {
      void job.tick().catch((e: unknown) => console.error('settlement tick', e))
    }, 10_000)
  : undefined
if (!owner) console.warn('no owner key: settlement is off (parties end without units being settled)')

const server = serve({ fetch: app.fetch, port: cfg.PORT }, (info) =>
  console.log(`api on http://localhost:${info.port}/api/health (${cfg.NEAR_NETWORK})`),
)

// Finish in-flight requests, then close the database cleanly.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(settleTimer)
    server.close(() => {
      db.close()
      process.exit(0)
    })
  })
}

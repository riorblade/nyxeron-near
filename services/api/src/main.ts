import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import type { TokenId } from '@nyxeron/game'
import { createApp } from './app.ts'
import { privyIdentity } from './auth.ts'
import { nearMpc, robinhoodChain, warehouse, warehouseAccount } from './chainsig.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { dexEthPrice, freshDepositsOnly, nearTreasury, warehouseFunder } from './fund.ts'
import { oneClick } from './intents.ts'
import { nearOwnerChain, nearProvider, nearRelayer } from './near.ts'
import { marketQuotes } from './quotes.ts'
import { robinhoodReader, verifyMenu } from './robinhood.ts'
import { type BuyShares, buySharesFor, settlement } from './settlement.ts'
import { hoodShares, type ProofSource } from './proof.ts'
import { kyberSwap, robinhoodHood, warehouseBuyer } from './swap.ts'

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
const quotes = marketQuotes({ allowed: new Set(menu.ok) })
// /proof: units on the contract; on mainnet also the warehouse's shares (set below once its signer exists).
const nearRead = nearProvider(cfg.NEAR_NETWORK)
const proof: ProofSource = {
  supply: async (token) =>
    BigInt(
      ((await nearRead.callFunction({
        contractId: cfg.CONTRACT_ID,
        method: 'mt_supply',
        args: { token_id: token },
      })) as string | null) ?? 0,
    ),
}
const app = createApp({ cfg, db, identity, quotes, relayer, oneclick, proof })

// Mainnet: the warehouse buys the real shares (swap.ts) and the treasury keeps it in USDG and gas (fund.ts), both with
// the warehouse account's key. Testnet keeps simulated purchases (SPEC §10).
let buyShares: BuyShares | undefined
let fundTimer: ReturnType<typeof setInterval> | undefined
if (cfg.NEAR_NETWORK === 'mainnet' && cfg.WAREHOUSE_ACCOUNT_ID && cfg.WAREHOUSE_KEY) {
  const hood = robinhoodHood()
  // One Account object for the MPC requests and the deposits, so they never fight over the key's nonce.
  const account = warehouseAccount(cfg.NEAR_NETWORK, cfg.WAREHOUSE_ACCOUNT_ID, cfg.WAREHOUSE_KEY, {
    mayResign: freshDepositsOnly(cfg.USDC_CONTRACT_ID),
  })
  const signer = warehouse({
    mpc: nearMpc({ network: cfg.NEAR_NETWORK, account }),
    chain: robinhoodChain(),
  })
  buyShares = warehouseBuyer({
    db,
    hood,
    kyber: kyberSwap(),
    signer,
    price: (token) => quotes.spot(token as TokenId),
    log: console.log,
  }).buyShares
  const funder = warehouseFunder({
    db,
    oneclick,
    treasury: nearTreasury({ account, usdcId: cfg.USDC_CONTRACT_ID }),
    chain: hood,
    warehouse: signer.address,
    ethPrice: dexEthPrice(),
    usdcId: cfg.USDC_CONTRACT_ID,
    log: console.log,
  })
  fundTimer = setInterval(() => {
    void funder.tick().catch((e: unknown) => console.error('warehouse funding tick', e))
  }, 15_000)
  proof.warehouse = { address: signer.address, sharesUi: hoodShares(signer.address) }
  void signer.address().then(
    (a) => console.log(`warehouse ${a} on Robinhood Chain, controlled by ${cfg.WAREHOUSE_ACCOUNT_ID}`),
    (e: unknown) => console.error('warehouse address', e),
  )
} else if (cfg.NEAR_NETWORK === 'mainnet') {
  console.warn('no warehouse key: mainnet parties stop at their mint (not_built)')
}

// After each party: release its wholesale, back the owed units, settle them to the guests (one tx at a time).
const owner = nearOwnerChain(cfg)
// One job for the process: its guard keeps a slow tick (a mainnet buy takes seconds) from overlapping the next one.
const job = owner
  ? settlement({ db, chain: owner, buyShares: buySharesFor(cfg, buyShares), log: console.log })
  : undefined
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
    clearInterval(fundTimer)
    server.close(() => {
      db.close()
      process.exit(0)
    })
  })
}

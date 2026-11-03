// The game's single source of truth: which stocks exist and the numbers money is settled with.
// Imported by services/api, apps/web and apps/agent, so there is never a copy to keep in sync.

export const CREDITS_PER_USD = 100
export const SHARES_PER_UNIT = 0.001
export const MAX_MARKUP = 3

// Each drink is a stock. `xstock` is the real token the warehouse holds on Solana.
// Mints checked against Jupiter (stockData.id = "xstocks") on 2026-11-03; confirm on xstocks.com before mainnet.
export const tokens = {
  tsla: {
    name: 'Tesla',
    ticker: 'TSLA',
    xstock: { symbol: 'TSLAx', mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB' },
  },
  nvda: {
    name: 'NVIDIA',
    ticker: 'NVDA',
    xstock: { symbol: 'NVDAx', mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh' },
  },
  spy: {
    name: 'S&P 500',
    ticker: 'SPY',
    xstock: { symbol: 'SPYx', mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W' },
  },
} as const

export type TokenId = keyof typeof tokens
export const tokenIds = Object.keys(tokens) as TokenId[]

export function isTokenId(id: string): id is TokenId {
  return Object.hasOwn(tokens, id)
}

// Wholesale price of one unit (0.001 share) in credits, rounded up so the platform never sells below cost.
export function wholesaleCredits(spotUsd: number): number {
  if (!Number.isFinite(spotUsd) || spotUsd <= 0) throw new RangeError(`bad spot price: ${spotUsd}`)
  // Rounded to 6 decimals first so float noise (e.g. 400.1 * 0.1 = 40.010000000000005) doesn't add a credit.
  return Math.ceil(Number((spotUsd * SHARES_PER_UNIT * CREDITS_PER_USD).toFixed(6)))
}

export function maxPriceCredits(wholesale: number): number {
  return wholesale * MAX_MARKUP
}

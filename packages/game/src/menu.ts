// The game's single source of truth: which stocks are on the menu and the numbers money is settled with.
// Imported by services/api and apps/web, so there is never a copy to keep in sync.

export const SHARES_PER_UNIT = 0.001
export const MAX_MARKUP = 3
// Buying the shares at party end costs ≈ 0.2 % + a few cents of gas (spike 15); wholesale carries this buffer so the
// platform never buys below what it charged.
export const WHOLESALE_BUFFER = 0.01
export const MICRO_USDC_PER_USD = 1_000_000

// Each drink is a Robinhood stock token on Robinhood Chain (id 4663). Addresses are pinned from the on-chain check in
// spike 18 (shared beacon-proxy code + Robinhood's beacon). Never look a stock up by name or ticker: fakes exist.
export const ROBINHOOD_CHAIN_ID = 4663
export const tokens = {
  tsla: { name: 'Tesla', ticker: 'TSLA', address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d' },
  nvda: { name: 'NVIDIA', ticker: 'NVDA', address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC' },
  aapl: { name: 'Apple', ticker: 'AAPL', address: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9' },
  googl: { name: 'Alphabet', ticker: 'GOOGL', address: '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3' },
  meta: { name: 'Meta', ticker: 'META', address: '0xc0d6457c16cc70d6790dd43521c899c87ce02f35' },
  msft: { name: 'Microsoft', ticker: 'MSFT', address: '0xe93237c50d904957cf27e7b1133b510c669c2e74' },
  spy: { name: 'S&P 500', ticker: 'SPY', address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C' },
  qqq: { name: 'Nasdaq 100', ticker: 'QQQ', address: '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68' },
  crcl: { name: 'Circle', ticker: 'CRCL', address: '0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5' },
  mstr: { name: 'Strategy', ticker: 'MSTR', address: '0xec262a75e413fafd0df80480274532c79d42da09' },
} as const

export type TokenId = keyof typeof tokens
export const tokenIds = Object.keys(tokens) as TokenId[]

export function isTokenId(id: string): id is TokenId {
  return Object.hasOwn(tokens, id)
}

// Wholesale price of one unit (0.001 share) in micro-USDC: market price plus the buffer, rounded up to the cent.
export function wholesaleMicroUsdc(priceUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new RangeError(`bad price: ${priceUsd}`)
  // Rounded to 6 decimals first so float noise (e.g. 0.40400000000000004) doesn't add a cent.
  const cents = Math.ceil(Number((priceUsd * SHARES_PER_UNIT * (1 + WHOLESALE_BUFFER) * 100).toFixed(6)))
  return cents * (MICRO_USDC_PER_USD / 100)
}

export function maxPriceMicroUsdc(wholesale: number): number {
  return wholesale * MAX_MARKUP
}

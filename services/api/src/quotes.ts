import { type TokenId, tokenIds, tokens } from '@nyxeron/game'
import { Hono } from 'hono'
import { z } from 'zod'
import { AppError } from './http.ts'

// Each drink is priced from its token's own market on Robinhood Chain, not from the share's last close: tokens trade
// 24/7 and can sit a few percent off the close (spikes 06, 07). DexScreener answers the whole menu in one call.
const DEXSCREENER = 'https://api.dexscreener.com/tokens/v1/robinhood'
// A pool thinner than this is ignored: its price is too easy to push.
export const MIN_LIQUIDITY_USD = 10_000

export type Quote = { usd: number; change24h: number; liquidityUsd: number }
export type Prices = { at: number; stale: boolean; prices: Partial<Record<TokenId, Quote>> }
export type Quotes = { latest(): Promise<Prices>; spot(id: TokenId): Promise<number> }

const Pair = z.looseObject({
  chainId: z.string(),
  baseToken: z.looseObject({ address: z.string() }),
  priceUsd: z.coerce.number().positive().finite(),
  priceChange: z.looseObject({ h24: z.number().finite().optional() }).optional(),
  liquidity: z.looseObject({ usd: z.number().finite().optional() }).optional(),
})

export function marketQuotes(
  opts: {
    fetch?: typeof fetch
    now?: () => number
    ttlMs?: number
    maxAgeMs?: number
    allowed?: ReadonlySet<TokenId>
  } = {},
): Quotes {
  const { fetch: doFetch = fetch, now = Date.now, ttlMs = 60_000, maxAgeMs = 10 * 60_000 } = opts
  const menu = tokenIds.filter((id) => !opts.allowed || opts.allowed.has(id))
  let cache: { at: number; prices: Prices['prices'] } | undefined
  let inflight: Promise<void> | undefined

  async function refresh() {
    const res = await doFetch(`${DEXSCREENER}/${menu.map((id) => tokens[id].address).join(',')}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`dexscreener: ${res.status}`)
    const raw = (await res.json()) as unknown
    const pairs = (Array.isArray(raw) ? raw : []).flatMap((p) => {
      const parsed = Pair.safeParse(p)
      return parsed.success && parsed.data.chainId === 'robinhood' ? [parsed.data] : []
    })
    const prices: Prices['prices'] = {}
    for (const id of menu) {
      // The deepest pool where this token is the base, so priceUsd is its own price.
      const best = pairs
        .filter((p) => p.baseToken.address.toLowerCase() === tokens[id].address.toLowerCase())
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
      const liquidityUsd = best?.liquidity?.usd ?? 0
      if (!best || liquidityUsd < MIN_LIQUIDITY_USD) continue
      prices[id] = { usd: best.priceUsd, change24h: best.priceChange?.h24 ?? 0, liquidityUsd: Math.round(liquidityUsd) }
    }
    if (Object.keys(prices).length === 0) throw new Error('dexscreener: no usable prices')
    cache = { at: now(), prices }
  }

  async function latest(): Promise<Prices> {
    if (!cache || now() - cache.at > ttlMs) {
      // One fetch at a time; a failed one keeps the last good answer.
      inflight ??= refresh()
        .catch((err: unknown) => console.warn('quotes refresh failed', err))
        .finally(() => {
          inflight = undefined
        })
      await inflight
    }
    // Nothing is priced against a quote older than maxAge.
    if (!cache || now() - cache.at > maxAgeMs) throw new AppError(503, 'quotes_unavailable')
    return { at: cache.at, stale: now() - cache.at > ttlMs, prices: cache.prices }
  }

  return {
    latest,
    async spot(id) {
      const quote = (await latest()).prices[id]
      if (!quote) throw new AppError(503, 'quotes_unavailable')
      return quote.usd
    },
  }
}

export function quoteRoutes(quotes: Quotes) {
  return new Hono().get('/', async (c) => {
    const prices = await quotes.latest()
    c.header('cache-control', 'public, max-age=30')
    return c.json(prices)
  })
}

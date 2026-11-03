import { type TokenId, tokenIds, tokens } from '@nyxeron/game'
import { Hono } from 'hono'
import { z } from 'zod'
import { AppError } from './http.ts'

// Jupiter Price API v3: the xStock's own price and, in stockData, the real share price. Free, no key.
const JUPITER = 'https://lite-api.jup.ag/price/v3'

export type Quote = { usd: number; xstockUsd: number; change24h: number }
export type Prices = { at: number; stale: boolean; prices: Partial<Record<TokenId, Quote>> }
export type Quotes = { latest(): Promise<Prices>; spot(id: TokenId): Promise<number> }

const Price = z.number().positive().finite()
const JupiterItem = z.looseObject({
  usdPrice: Price,
  priceChange24h: z.number().finite().optional(),
  stockData: z.looseObject({ price: Price }).optional(),
})

export function jupiterQuotes(
  opts: { fetch?: typeof fetch; now?: () => number; ttlMs?: number; maxAgeMs?: number } = {},
): Quotes {
  const { fetch: doFetch = fetch, now = Date.now, ttlMs = 60_000, maxAgeMs = 10 * 60_000 } = opts
  let cache: { at: number; prices: Prices['prices'] } | undefined
  let inflight: Promise<void> | undefined

  async function refresh() {
    const ids = tokenIds.map((id) => tokens[id].xstock.mint).join(',')
    const res = await doFetch(`${JUPITER}?ids=${ids}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`jupiter: ${res.status}`)
    const raw = (await res.json()) as Record<string, unknown> | null
    const prices: Prices['prices'] = {}
    for (const id of tokenIds) {
      const item = JupiterItem.safeParse(raw?.[tokens[id].xstock.mint])
      if (!item.success) continue
      const { usdPrice, priceChange24h, stockData } = item.data
      prices[id] = { usd: stockData?.price ?? usdPrice, xstockUsd: usdPrice, change24h: priceChange24h ?? 0 }
    }
    if (Object.keys(prices).length === 0) throw new Error('jupiter: no usable prices')
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

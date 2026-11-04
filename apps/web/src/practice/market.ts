import { isTokenId, type Market } from '@nyxeron/game'
import { api } from '../api.ts'

// Used when the api can't be reached (offline, or the quotes are down): real prices from 5 Nov 2026, labelled as such.
export const SAMPLE_MARKET: Market = {
  tsla: { priceUsd: 388.8, change24h: -2.03 },
  nvda: { priceUsd: 203.54, change24h: -2.38 },
  aapl: { priceUsd: 354.11, change24h: 6.44 },
  googl: { priceUsd: 292.19, change24h: 4.09 },
  meta: { priceUsd: 639.05, change24h: 2.8 },
  msft: { priceUsd: 553.38, change24h: 6.86 },
  spy: { priceUsd: 769.79, change24h: 1.72 },
  qqq: { priceUsd: 694.34, change24h: 1.25 },
  crcl: { priceUsd: 76.12, change24h: 0.05 },
  mstr: { priceUsd: 144.76, change24h: 6.24 },
}

export type MarketSource = { market: Market; live: boolean; at: number | null }

/** The api's quotes as the game's market; unknown tokens are dropped. */
export function toMarket(prices: Record<string, { usd: number; change24h: number }>): Market {
  const market: Market = {}
  for (const [id, p] of Object.entries(prices))
    if (isTokenId(id)) market[id] = { priceUsd: p.usd, change24h: p.change24h }
  return market
}

export async function loadMarket(): Promise<MarketSource> {
  try {
    const res = await api.quotes.$get()
    if (!res.ok) throw new Error(`quotes ${res.status}`)
    const body = await res.json()
    const market = toMarket(body.prices)
    if (Object.keys(market).length === 0) throw new Error('no prices')
    return { market, live: !body.stale, at: body.at }
  } catch {
    return { market: SAMPLE_MARKET, live: false, at: null }
  }
}

import { tokens } from '@nyxeron/game'
import { describe, expect, it } from 'vitest'
import { marketQuotes } from './quotes.ts'
import { testApp } from './testing.ts'

const pair = (address: string, priceUsd: string, liquidityUsd: number, h24 = 0) => ({
  chainId: 'robinhood',
  dexId: 'uniswap',
  baseToken: { address, symbol: 'X' },
  quoteToken: { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', symbol: 'USDG' },
  priceUsd,
  priceChange: { h24 },
  liquidity: { usd: liquidityUsd },
})

// Shaped like a real DexScreener answer (2026-11-04), trimmed.
const answer = [
  pair(tokens.tsla.address, '376.30', 328_216, -6.82),
  pair(tokens.tsla.address, '380.00', 2_000), // thinner pool: ignored for TSLA
  pair(tokens.nvda.address, '206.89', 1_125_300),
  pair(tokens.aapl.address, '335.55', 9_000), // below the liquidity floor: no AAPL price
  { ...pair('0x0000000000000000000000000000000000000001', '1', 50_000), baseToken: { address: tokens.spy.address } },
  { ...pair(tokens.qqq.address, 'junk', 50_000) },
  { ...pair(tokens.meta.address, '627.31', 482_970), chainId: 'ethereum' }, // another chain: ignored
]

function setup(responses: Array<unknown | 'fail'>, allowed?: ReadonlySet<'tsla' | 'nvda'>) {
  let t = 1_000_000
  let calls = 0
  let lastUrl = ''
  const fakeFetch = (async (url: string) => {
    lastUrl = url
    const next = responses[Math.min(calls++, responses.length - 1)]
    if (next === 'fail') throw new Error('network down')
    return Response.json(next)
  }) as unknown as typeof fetch
  const quotes = marketQuotes({ fetch: fakeFetch, now: () => t, allowed })
  return { quotes, calls: () => calls, url: () => lastUrl, wait: (ms: number) => (t += ms) }
}

describe('marketQuotes', () => {
  it('takes the deepest pool where the token is the base, and skips thin or broken ones', async () => {
    const { quotes } = setup([answer])
    const { prices } = await quotes.latest()
    expect(prices.tsla).toEqual({ usd: 376.3, change24h: -6.82, liquidityUsd: 328_216 })
    expect(prices.nvda?.usd).toBe(206.89)
    expect(prices.aapl).toBeUndefined()
    expect(prices.qqq).toBeUndefined()
    expect(prices.meta).toBeUndefined()
    expect(await quotes.spot('tsla')).toBe(376.3)
    await expect(quotes.spot('aapl')).rejects.toThrow('quotes_unavailable')
  })

  it('asks only for tokens that passed the on-chain check', async () => {
    const { quotes, url } = setup([answer], new Set(['tsla']))
    const { prices } = await quotes.latest()
    expect(Object.keys(prices)).toEqual(['tsla'])
    expect(url()).toContain(tokens.tsla.address)
    expect(url()).not.toContain(tokens.nvda.address)
  })

  it('asks once per minute, and once for many callers at the same time', async () => {
    const { quotes, calls, wait } = setup([answer])
    await Promise.all([quotes.latest(), quotes.latest(), quotes.latest()])
    expect(calls()).toBe(1)
    wait(59_000)
    await quotes.latest()
    expect(calls()).toBe(1)
    wait(2_000)
    await quotes.latest()
    expect(calls()).toBe(2)
  })

  it('keeps the last good prices when the source fails, marked stale, for up to 10 minutes', async () => {
    const { quotes, wait } = setup([answer, 'fail'])
    await quotes.latest()
    wait(5 * 60_000)
    const later = await quotes.latest()
    expect(later.stale).toBe(true)
    expect(later.prices.tsla?.usd).toBe(376.3)
    wait(6 * 60_000)
    await expect(quotes.latest()).rejects.toThrow('quotes_unavailable')
  })

  it('answers quotes_unavailable when it never had a price', async () => {
    await expect(setup(['fail']).quotes.latest()).rejects.toThrow('quotes_unavailable')
    await expect(setup([{ junk: true }]).quotes.latest()).rejects.toThrow('quotes_unavailable')
  })
})

describe('GET /api/quotes', () => {
  it('serves prices without sign-in, cacheable for 30 s', async () => {
    const res = await testApp().call('GET', '/api/quotes')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=30')
    expect(await res.json()).toMatchObject({ prices: { tsla: { usd: 400 } } })
  })
})

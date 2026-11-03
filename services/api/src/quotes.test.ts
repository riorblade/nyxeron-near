import { tokens } from '@nyxeron/game'
import { describe, expect, it } from 'vitest'
import { jupiterQuotes } from './quotes.ts'
import { testApp } from './testing.ts'

// Shaped like a real Jupiter answer (2026-11-03), trimmed.
const answer = {
  [tokens.tsla.xstock.mint]: {
    usdPrice: 401.02,
    priceChange24h: -2.06,
    decimals: 8,
    stockData: { id: 'xstocks', price: 402.315 },
  },
  [tokens.nvda.xstock.mint]: { usdPrice: 207.39, stockData: { id: 'xstocks', price: 208.205 } },
  [tokens.spy.xstock.mint]: { usdPrice: 'not a number' },
}

function setup(responses: Array<unknown | 'fail'>) {
  let t = 1_000_000
  let calls = 0
  const fakeFetch = (async () => {
    const next = responses[Math.min(calls++, responses.length - 1)]
    if (next === 'fail') throw new Error('network down')
    return Response.json(next)
  }) as unknown as typeof fetch
  const quotes = jupiterQuotes({ fetch: fakeFetch, now: () => t })
  return {
    quotes,
    calls: () => calls,
    wait: (ms: number) => {
      t += ms
    },
  }
}

describe('jupiterQuotes', () => {
  it('reads the share price and the xStock price, and skips what it cannot read', async () => {
    const { quotes } = setup([answer])
    const { prices, stale } = await quotes.latest()
    expect(stale).toBe(false)
    expect(prices.tsla).toEqual({ usd: 402.315, xstockUsd: 401.02, change24h: -2.06 })
    expect(prices.nvda).toEqual({ usd: 208.205, xstockUsd: 207.39, change24h: 0 })
    expect(prices.spy).toBeUndefined()
    expect(await quotes.spot('tsla')).toBe(402.315)
    await expect(quotes.spot('spy')).rejects.toThrow('quotes_unavailable')
  })

  it('asks Jupiter once per minute, and once for many callers at the same time', async () => {
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

  it('keeps the last good prices when Jupiter fails, marked stale, for up to 10 minutes', async () => {
    const { quotes, wait } = setup([answer, 'fail'])
    await quotes.latest()
    wait(5 * 60_000)
    const later = await quotes.latest()
    expect(later.stale).toBe(true)
    expect(later.prices.tsla?.usd).toBe(402.315)
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

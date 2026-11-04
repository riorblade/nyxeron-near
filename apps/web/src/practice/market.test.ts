import { tokenIds } from '@nyxeron/game'
import { describe, expect, it } from 'vitest'
import { SAMPLE_MARKET, toMarket } from './market.ts'

describe('toMarket', () => {
  it('keeps menu tokens and drops anything else', () => {
    const market = toMarket({
      tsla: { usd: 388.8, change24h: -2 },
      fake: { usd: 1, change24h: 0 },
    })
    expect(market).toEqual({ tsla: { priceUsd: 388.8, change24h: -2 } })
  })

  it('has a sample price for every drink on the menu', () => {
    for (const id of tokenIds) expect(SAMPLE_MARKET[id]?.priceUsd).toBeGreaterThan(0)
  })
})

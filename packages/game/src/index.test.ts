import { describe, expect, it } from 'vitest'
import { isTokenId, maxPriceCredits, wholesaleCredits } from './index.ts'

describe('wholesaleCredits', () => {
  it('prices a unit at 0.001 share, in credits, rounded up', () => {
    expect(wholesaleCredits(400)).toBe(40)
    expect(wholesaleCredits(401.02)).toBe(41)
    expect(wholesaleCredits(208.2)).toBe(21)
  })

  it('ignores float noise instead of adding a credit', () => {
    expect(wholesaleCredits(400.1 - 0.1)).toBe(40)
  })

  it('refuses a broken price', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => wholesaleCredits(bad)).toThrow()
  })
})

describe('tokens', () => {
  it('knows its own ids and nothing inherited', () => {
    expect(isTokenId('tsla')).toBe(true)
    expect(isTokenId('toString')).toBe(false)
  })

  it('caps a CEO price at 3x wholesale', () => {
    expect(maxPriceCredits(40)).toBe(120)
  })
})

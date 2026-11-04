import { describe, expect, it } from 'vitest'
import { isTokenId, maxPriceMicroUsdc, tokenIds, tokens, wholesaleMicroUsdc } from './menu.ts'

describe('menu', () => {
  it('has ten pinned Robinhood stock tokens with distinct addresses', () => {
    expect(tokenIds).toHaveLength(10)
    const addresses = tokenIds.map((id) => tokens[id].address.toLowerCase())
    for (const a of addresses) expect(a).toMatch(/^0x[0-9a-f]{40}$/)
    expect(new Set(addresses).size).toBe(10)
  })

  it('pins the genuine Tesla, never a lookalike', () => {
    expect(tokens.tsla.address.toLowerCase()).toBe('0x322f0929c4625ed5bad873c95208d54e1c003b2d')
  })

  it('knows its own ids and nothing inherited', () => {
    expect(isTokenId('tsla')).toBe(true)
    expect(isTokenId('toString')).toBe(false)
  })
})

describe('wholesaleMicroUsdc', () => {
  it('prices a unit at 0.001 share plus 1 %, rounded up to the cent', () => {
    expect(wholesaleMicroUsdc(400)).toBe(410_000) // 0.404 → $0.41
    expect(wholesaleMicroUsdc(75.26)).toBe(80_000) // 0.0760 → $0.08
    expect(wholesaleMicroUsdc(990)).toBe(1_000_000) // 0.9999 → $1.00
  })

  it('ignores float noise instead of adding a cent', () => {
    expect(wholesaleMicroUsdc(396.03960396039605)).toBe(400_000) // exactly $0.40 after the buffer
  })

  it('refuses a broken price', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => wholesaleMicroUsdc(bad)).toThrow()
  })

  it('caps a CEO price at 3x wholesale', () => {
    expect(maxPriceMicroUsdc(410_000)).toBe(1_230_000)
  })
})

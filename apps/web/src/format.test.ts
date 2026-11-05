import { describe, expect, it } from 'vitest'
import { clock, pct, usd } from './format.ts'

describe('format', () => {
  it('shows micro-USDC as dollars', () => {
    expect(usd(410_000)).toBe('$0.41')
    expect(usd(12_345_678)).toBe('$12.35')
    expect(usd(-50_000)).toBe('−$0.05')
  })

  it('turns game minutes into the clock of the night', () => {
    expect(clock(0)).toBe('22:00')
    expect(clock(125)).toBe('00:05')
    expect(clock(300)).toBe('03:00')
  })

  it('signs percentages', () => {
    expect(pct(4.08)).toBe('+4.1 %')
    expect(pct(-2)).toBe('−2.0 %')
  })
})

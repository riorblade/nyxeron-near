import { describe, expect, it } from 'vitest'
import { owedTo, shares, unitsByToken } from './holdings.ts'

describe('holdings', () => {
  it('keeps only the tokens the player has', () => {
    expect(unitsByToken(['tsla', 'nvda', 'spy'], ['3', '0', '12'])).toEqual({ tsla: 3, spy: 12 })
    expect(unitsByToken(['tsla'], undefined)).toEqual({})
  })

  it('sums what one player is owed per party and ignores everyone else', () => {
    const owed = owedTo('me', {
      42: [
        { account_id: 'me', token: 'tsla', qty: 2 },
        { account_id: 'you', token: 'tsla', qty: 5 },
        { account_id: 'me', token: 'tsla', qty: '1' },
      ],
      43: [{ account_id: 'you', token: 'spy', qty: 1 }],
      44: undefined,
    })
    expect(owed).toEqual({ 42: { tsla: 3 } })
  })

  it('reads units as shares', () => {
    expect(shares(3)).toBe('0.003')
    expect(shares(1250)).toBe('1.250')
  })
})

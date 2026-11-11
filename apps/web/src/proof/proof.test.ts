import { describe, expect, it } from 'vitest'
import { backedText, proofText } from './proof.ts'

const row = { token: 'tsla', ticker: 'TSLA', address: '0x1', units: '3', sharesOwed: '0.003', sharesHeld: null }

describe('proof', () => {
  it('names a mint proof: simulated on testnet, else the swap', () => {
    expect(proofText('demo:a1-7:tsla:1')).toBe('simulated purchase (testnet)')
    const hash = `0x${'ab'.repeat(32)}`
    expect(proofText(hash)).toBe(`Robinhood Chain swap ${hash.slice(0, 10)}…${hash.slice(-6)}`)
    expect(proofText(`${hash}+1`)).toMatch(/and 1 more swap$/)
    expect(proofText(`${hash}+2`)).toMatch(/and 2 more swaps$/)
    expect(proofText(null)).toBeUndefined()
  })

  it('marks backing only when both sides were read', () => {
    expect(backedText({ ...row, backed: null })).toBeUndefined()
    expect(backedText({ ...row, sharesHeld: '0.003', backed: true })).toEqual({ text: 'backed', ok: true })
    expect(backedText({ ...row, sharesHeld: '0.002', backed: false })).toEqual({ text: 'short', ok: false })
  })
})

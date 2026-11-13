import { describe, expect, it } from 'vitest'
import { backedText, proofLink, proofText } from './proof.ts'

const row = {
  token: 'tsla',
  ticker: 'TSLA',
  address: '0x1',
  units: '3',
  sharesOwed: '0.003',
  sharesHeld: null,
  simulatedUnits: '0',
}

describe('proof', () => {
  it('names a mint proof: simulated on testnet, else the swap', () => {
    expect(proofText('demo:a1-7:tsla:1')).toBe('simulated purchase (testnet)')
    const hash = `0x${'ab'.repeat(32)}`
    expect(proofText(hash)).toBe(`Robinhood Chain swap ${hash.slice(0, 10)}…${hash.slice(-6)}`)
    expect(proofText(`${hash}+1`)).toMatch(/and 1 more swap$/)
    expect(proofText(`${hash}+2`)).toMatch(/and 2 more swaps$/)
    expect(proofText(null)).toBeUndefined()
  })

  it('says a testnet swap bought synthetic stock, and links each swap to its explorer', () => {
    const hash = `0x${'ab'.repeat(32)}`
    const testnet = { chainId: 46630, explorer: 'https://explorer.testnet.chain.robinhood.com', synthetic: true }
    expect(proofText(hash, testnet)).toBe(
      `Robinhood Chain testnet swap (synthetic stock) ${hash.slice(0, 10)}…${hash.slice(-6)}`,
    )
    expect(proofLink(`${hash}+1`, testnet)).toBe(`https://explorer.testnet.chain.robinhood.com/tx/${hash}`)
    expect(proofLink('demo:a1-7:tsla:1', testnet)).toBeUndefined()
    expect(proofLink(null, testnet)).toBeUndefined()
  })

  it('marks backing only when both sides were read', () => {
    expect(backedText({ ...row, backed: null })).toBeUndefined()
    expect(backedText({ ...row, sharesHeld: '0.003', backed: true })).toEqual({ text: 'backed', ok: true })
    expect(backedText({ ...row, sharesHeld: '0.002', backed: false })).toEqual({ text: 'short', ok: false })
  })
})

import { describe, expect, it } from 'vitest'
import { type Settlement, settleHash, settlementNote, stepLabel } from './settlement.ts'

describe('settlement', () => {
  it('has words for every status the api sends', () => {
    for (const s of ['live', 'waiting', 'pending', 'done', 'failed', 'off'] as const)
      expect(settlementNote(s).text.length).toBeGreaterThan(10)
    expect(settlementNote('done').tone).toBe('up')
    expect(settlementNote('failed').tone).toBe('down')
  })

  it('links the last settle batch that landed', () => {
    const s: Settlement = {
      status: 'done',
      ops: [
        { kind: 'release', hash: 'r1', status: 'done' },
        { kind: 'mint', token: 'tsla', units: '3', hash: 'm1', status: 'done' },
        { kind: 'settle', units: '2', hash: 's1', status: 'done' },
        { kind: 'settle', units: '1', hash: 's2', status: 'done' },
      ],
    }
    expect(settleHash(s)).toBe('s2')
    expect(settleHash({ status: 'pending', ops: [{ kind: 'settle', units: '3', status: 'sent' }] })).toBeUndefined()
  })

  it('names each step for /proof', () => {
    const ticker = (id: string) => id.toUpperCase()
    expect(stepLabel({ kind: 'mint', token: 'tsla', units: '3', status: 'done' }, ticker)).toBe(
      'Shares bought and units minted · TSLA · 3 units',
    )
    expect(stepLabel({ kind: 'release', status: 'done' }, ticker)).toBe('Party money released for the shares')
  })
})

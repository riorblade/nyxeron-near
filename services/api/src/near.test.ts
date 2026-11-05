import { describe, expect, it } from 'vitest'
import { summarise } from './near.ts'

const ok = { SuccessValue: '' }
const tx = (logs: string[], status: unknown = ok) => ({
  transaction: { hash: 'h' },
  status: ok,
  receipts_outcome: [{ outcome: { status, logs } }],
})
const event = (e: object) => `EVENT_JSON:${JSON.stringify({ standard: 'nyxeron', version: '1.0.0', ...e })}`

describe('summarise a relayed transaction', () => {
  it('a purchase the contract accepted is ok', () => {
    expect(summarise(tx([event({ event: 'purchase', data: [{}] })]))).toEqual({ hash: 'h', ok: true })
  })

  it('a purchase the contract refunded is not, with its reason', () => {
    const refunded = tx([event({ event: 'refund', data: [{ sender_id: 'a', amount: '1', reason: 'expired' }] })])
    expect(summarise(refunded)).toEqual({ hash: 'h', ok: false, error: 'refund:expired' })
  })

  it('ignores other contracts and malformed logs; a failed receipt still fails', () => {
    const noise = ['EVENT_JSON:{bad', `EVENT_JSON:${JSON.stringify({ standard: 'nep141', event: 'refund', data: [] })}`]
    expect(summarise(tx(noise))).toEqual({ hash: 'h', ok: true })
    expect(summarise(tx([], { Failure: { x: 1 } })).ok).toBe(false)
  })
})

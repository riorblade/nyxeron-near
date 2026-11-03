import { describe, expect, it } from 'vitest'
import { all, one, openDb, run, tx } from './db.ts'
import { AppError } from './http.ts'
import { moveCredits } from './ledger.ts'

function withPlayer() {
  const db = openDb(':memory:')
  run(db, "INSERT INTO users (id, created_at, last_seen) VALUES ('p', 0, 0)")
  return db
}
const credits = (db: ReturnType<typeof withPlayer>) =>
  one<{ credits: number }>(db, "SELECT credits FROM users WHERE id = 'p'")!.credits

describe('moveCredits', () => {
  it('adds and spends, writing the balance after each move', () => {
    const db = withPlayer()
    expect(tx(db, () => moveCredits(db, 'p', 500, 'topup', 'topup:1'))).toBe(500)
    expect(tx(db, () => moveCredits(db, 'p', -120, 'purchase', 'sale:1'))).toBe(380)
    expect(credits(db)).toBe(380)
    const rows = all<{ delta: number; balance: number; kind: string; ref: string }>(
      db,
      "SELECT delta, balance, kind, ref FROM ledger WHERE user_id = 'p' ORDER BY id",
    )
    expect(rows).toEqual([
      { delta: 500, balance: 500, kind: 'topup', ref: 'topup:1' },
      { delta: -120, balance: 380, kind: 'purchase', ref: 'sale:1' },
    ])
  })

  it('refuses to spend more than the player has, and changes nothing', () => {
    const db = withPlayer()
    tx(db, () => moveCredits(db, 'p', 100, 'topup'))
    const err = (() => {
      try {
        tx(db, () => moveCredits(db, 'p', -101, 'purchase'))
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('insufficient_credits')
    expect(credits(db)).toBe(100)
    expect(all(db, 'SELECT * FROM ledger')).toHaveLength(1)
  })

  it('only runs inside a transaction', () => {
    const db = withPlayer()
    expect(() => moveCredits(db, 'p', 1, 'topup')).toThrow(/inside tx/)
  })

  it('refuses zero, fractions and unknown players', () => {
    const db = withPlayer()
    for (const bad of [0, 1.5, Number.NaN]) expect(() => tx(db, () => moveCredits(db, 'p', bad, 'topup'))).toThrow()
    expect(() => tx(db, () => moveCredits(db, 'nobody', 1, 'topup'))).toThrow('no_user')
  })

  it('keeps the ledger summing to the balance after many moves', () => {
    const db = withPlayer()
    const deltas = [300, -50, 20, -200, 1000, -1, -69]
    for (const d of deltas) tx(db, () => moveCredits(db, 'p', d, d > 0 ? 'topup' : 'purchase'))
    const sum = one<{ s: number }>(db, "SELECT sum(delta) AS s FROM ledger WHERE user_id = 'p'")!.s
    expect(sum).toBe(credits(db))
  })
})

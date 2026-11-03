import { type Db, one, run } from './db.ts'
import { AppError } from './http.ts'

export type CreditKind = 'topup' | 'purchase' | 'sale' | 'refund' | 'demo'

// The only way credits change. Must run inside tx() together with whatever caused it, so a balance and its reason
// are always written together or not at all. Returns the new balance.
export function moveCredits(
  db: Db,
  userId: string,
  delta: number,
  kind: CreditKind,
  ref = '',
  now = Date.now(),
): number {
  if (!db.isTransaction) throw new Error('moveCredits must run inside tx()')
  if (!Number.isSafeInteger(delta) || delta === 0) throw new RangeError(`bad credit delta: ${delta}`)
  const row = one<{ credits: number }>(db, 'SELECT credits FROM users WHERE id = ?', userId)
  if (!row) throw new AppError(404, 'no_user')
  const balance = row.credits + delta
  if (balance < 0) throw new AppError(409, 'insufficient_credits')
  run(db, 'UPDATE users SET credits = ? WHERE id = ?', balance, userId)
  run(
    db,
    'INSERT INTO ledger (user_id, delta, balance, kind, ref, at) VALUES (?, ?, ?, ?, ?, ?)',
    userId,
    delta,
    balance,
    kind,
    ref,
    now,
  )
  return balance
}

import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, type Identity, requireActive, requireUser, type User } from './auth.ts'
import type { Config } from './config.ts'
import { all, type Db, one, run, tx } from './db.ts'
import { AppError, validate } from './http.ts'
import { moveCredits } from './ledger.ts'

export const DEMO_CREDITS = 10_000 // $100 of play money, testnet only
const DAY = 24 * 60 * 60 * 1000

const Name = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N} _.-]+$/u, 'letters, digits, space, _ . - only')

export function me(u: User) {
  return {
    id: u.id,
    email: u.email,
    nearAccount: u.near_account,
    name: u.name,
    credits: u.credits,
    banned: u.banned === 1,
  }
}

export function playerRoutes(deps: { cfg: Config; db: Db; identity: Identity }) {
  const { db } = deps
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', (c) => c.json(me(c.var.user)))
    .patch('/', requireActive, validate('json', z.object({ name: Name })), (c) => {
      const { name } = c.req.valid('json')
      run(db, 'UPDATE users SET name = ? WHERE id = ?', name, c.var.user.id)
      return c.json(me({ ...c.var.user, name }))
    })
    .get('/ledger', (c) => {
      const entries = all<{ delta: number; balance: number; kind: string; ref: string; at: number }>(
        db,
        'SELECT delta, balance, kind, ref, at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50',
        c.var.user.id,
      )
      return c.json({ entries })
    })
    .post('/demo-credits', requireActive, (c) => {
      if (!deps.cfg.DEMO_MODE) throw new AppError(404, 'not_found')
      const now = Date.now()
      const credits = tx(db, () => {
        const last = one<{ at: number }>(
          db,
          "SELECT at FROM ledger WHERE user_id = ? AND kind = 'demo' ORDER BY id DESC LIMIT 1",
          c.var.user.id,
        )
        if (last && now - last.at < DAY) throw new AppError(429, 'too_soon')
        return moveCredits(db, c.var.user.id, DEMO_CREDITS, 'demo', '', now)
      })
      return c.json({ credits })
    })
}

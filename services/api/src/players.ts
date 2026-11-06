import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, type Identity, requireActive, requireUser, type User } from './auth.ts'
import type { Config } from './config.ts'
import { all, type Db, one, run, tx } from './db.ts'
import { AppError, rateLimit, validate } from './http.ts'
import { moveCredits } from './ledger.ts'
import type { Relayer } from './near.ts'

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

export function playerRoutes(deps: { cfg: Config; db: Db; identity: Identity; relayer?: Relayer }) {
  const { db, cfg } = deps
  const faucetLimit = rateLimit(3, 60_000)
  return (
    new Hono<AppEnv>()
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
      // Testnet only: real Circle testnet USDC from the relayer, so a judge can buy drinks (SPEC §10, §11 step 4).
      .post('/test-dollars', requireActive, async (c) => {
        if (cfg.NEAR_NETWORK !== 'testnet') throw new AppError(403, 'not_testnet')
        if (!cfg.DEMO_MODE) throw new AppError(403, 'demo_off')
        const r = deps.relayer
        const faucet = cfg.RELAYER_ACCOUNT_ID
        if (!r || !faucet) throw new AppError(503, 'faucet_off')
        const account = c.var.user.near_account
        if (!account) throw new AppError(409, 'no_near_account')
        faucetLimit(c.var.user.id)
        const amount = cfg.TEST_DOLLARS
        const now = Date.now()
        // Reserve today's grant before sending: a second request finds this row and stops.
        const grant = tx(db, () => {
          const last = one<{ at: number }>(
            db,
            "SELECT at FROM test_dollars WHERE user_id = ? AND status <> 'failed' ORDER BY at DESC LIMIT 1",
            c.var.user.id,
          )
          if (last && now - last.at < DAY) throw new AppError(429, 'too_soon')
          return one<{ id: number }>(
            db,
            "INSERT INTO test_dollars (user_id, account, amount, status, at) VALUES (?, ?, ?, 'sending', ?) RETURNING id",
            c.var.user.id,
            account,
            amount,
            now,
          )!.id
        })
        // ponytail: a transfer that lands but times out on our side is marked failed, so that player could get a second
        // grant the same day; a few test dollars, acceptable.
        const fail = (code: string, detail = '') => {
          run(db, "UPDATE test_dollars SET status = 'failed', error = ? WHERE id = ?", detail || code, grant)
          return code
        }
        try {
          const usdc = cfg.USDC_CONTRACT_ID
          if (!(await r.isRegistered(usdc, account))) throw new AppError(409, fail('not_onboarded'))
          if ((await r.ftBalance(usdc, faucet)) < BigInt(amount)) throw new AppError(503, fail('faucet_empty'))
          const sent = await r.ftTransfer(usdc, account, BigInt(amount), 'NYXERON test dollars')
          if (!sent.ok) throw new AppError(502, fail('faucet_failed', sent.error))
          run(db, "UPDATE test_dollars SET status = 'sent', tx_hash = ? WHERE id = ?", sent.hash, grant)
          return c.json({ hash: sent.hash, amount })
        } catch (e) {
          if (!(e instanceof AppError)) fail('faucet_failed', String(e).slice(0, 300))
          throw e
        }
      })
  )
}

import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { type Identity, requireUser, type User } from './auth.ts'
import type { Config } from './config.ts'
import { all, type Db, one, run, tx } from './db.ts'
import { AppError, validate } from './http.ts'
import { type OpRow, retryOp } from './settlement.ts'

export type Role = 'owner' | 'admin' | 'viewer'
type AdminEnv = { Variables: { user: User; role: Role } }

// Roles come from the email Privy verified: owners from OWNER_EMAILS, the rest from the admins table.
export function roleOf(db: Db, cfg: Config, email: string): Role | undefined {
  if (!email) return undefined
  if (cfg.OWNER_EMAILS.includes(email)) return 'owner'
  return one<{ role: Role }>(db, 'SELECT role FROM admins WHERE email = ?', email)?.role
}

const Reason = z.object({ reason: z.string().trim().min(3).max(200) })
const StaffEmail = z.string().trim().toLowerCase().pipe(z.email())

// Owners and admins act; viewers only read.
const canAct = (role: Role) => {
  if (role === 'viewer') throw new AppError(403, 'read_only')
}
export function audit(db: Db, actor: string, action: string, target: string, reason = '') {
  run(
    db,
    'INSERT INTO audit (actor, action, target, reason, at) VALUES (?, ?, ?, ?, ?)',
    actor,
    action,
    target,
    reason,
    Date.now(),
  )
}

const UserQuery = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export function adminRoutes(deps: { cfg: Config; db: Db; identity: Identity }) {
  const { db, cfg } = deps
  return (
    new Hono<AdminEnv>()
      .use(requireUser(deps))
      .use(
        createMiddleware<AdminEnv>(async (c, next) => {
          const role = roleOf(db, cfg, c.var.user.email)
          if (!role) throw new AppError(403, 'not_admin')
          c.set('role', role)
          await next()
        }),
      )
      .get('/me', (c) => c.json({ email: c.var.user.email, role: c.var.role }))
      // Settlement steps that ran out of retries; a retry checks the chain first, so it never doubles a step. `stuck`:
      // warehouse swaps and fundings the api stopped on because it can't tell whether money moved (swap.ts, fund.ts).
      // They block that token's or asset's purchases until a person checks the hash and sets the row by hand.
      .get('/settlement', (c) => {
        const ops = all<OpRow>(db, "SELECT * FROM chain_ops WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 100")
        const stuck = all<{ kind: string; id: string; error: string; hash: string; at: number }>(
          db,
          `SELECT 'swap' AS kind, id, error, tx_hash AS hash, at FROM warehouse_swaps WHERE status = 'stuck'
           UNION ALL
           SELECT 'funding', id, error, deposit_tx, created_at FROM warehouse_funding WHERE status = 'stuck'
           ORDER BY at DESC LIMIT 100`,
        )
        return c.json({
          stuck,
          failed: ops.map((o) => ({
            id: o.id,
            party: o.party_id,
            kind: o.kind,
            attempts: o.attempts,
            error: o.error,
            updatedAt: o.updated_at,
          })),
        })
      })
      .post('/settlement/:op/retry', validate('param', z.object({ op: z.string().min(1).max(80) })), (c) => {
        canAct(c.var.role)
        const op = c.req.valid('param').op
        tx(db, () => {
          if (!retryOp(db, op)) throw new AppError(404, 'no_failed_op')
          audit(db, c.var.user.email, 'retry', op)
        })
        return c.json({ ok: true })
      })
      // Ban / unban a player, always with a reason. Staff can't be banned from here (an owner edits OWNER_EMAILS or
      // removes the staff role first), and nobody bans themself.
      .post(
        '/users/:id/:action{ban|unban}',
        validate('param', z.object({ id: z.string().min(1).max(200), action: z.enum(['ban', 'unban']) })),
        validate('json', Reason),
        (c) => {
          canAct(c.var.role)
          const { id, action } = c.req.valid('param')
          const { reason } = c.req.valid('json')
          const target = one<User>(db, 'SELECT * FROM users WHERE id = ?', id)
          if (!target) throw new AppError(404, 'not_found')
          if (target.id === c.var.user.id) throw new AppError(403, 'not_yourself')
          if (roleOf(db, cfg, target.email)) throw new AppError(403, 'is_staff')
          const ban = action === 'ban'
          if ((target.banned === 1) === ban) throw new AppError(409, ban ? 'already_banned' : 'not_banned')
          tx(db, () => {
            run(db, 'UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?', ban ? 1 : 0, ban ? reason : '', id)
            audit(db, c.var.user.email, action, id, reason)
          })
          return c.json({ id, banned: ban, banReason: ban ? reason : '' })
        },
      )
      // Staff: everyone may see who; only an owner adds or removes (owners themselves come from OWNER_EMAILS).
      .get('/staff', (c) =>
        c.json({
          owners: cfg.OWNER_EMAILS,
          staff: all<{ email: string; role: Role; granted_by: string; at: number }>(
            db,
            'SELECT email, role, granted_by, at FROM admins ORDER BY at',
          ).map((a) => ({ email: a.email, role: a.role, grantedBy: a.granted_by, at: a.at })),
        }),
      )
      .put('/staff', validate('json', z.object({ email: StaffEmail, role: z.enum(['admin', 'viewer']) })), (c) => {
        if (c.var.role !== 'owner') throw new AppError(403, 'owner_only')
        const { email, role } = c.req.valid('json')
        if (cfg.OWNER_EMAILS.includes(email)) throw new AppError(409, 'is_owner')
        tx(db, () => {
          run(
            db,
            `INSERT INTO admins (email, role, granted_by, at) VALUES (?, ?, ?, ?)
               ON CONFLICT (email) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, at = excluded.at`,
            email,
            role,
            c.var.user.email,
            Date.now(),
          )
          audit(db, c.var.user.email, 'staff_add', email, role)
        })
        return c.json({ email, role })
      })
      .delete('/staff/:email', validate('param', z.object({ email: StaffEmail })), (c) => {
        if (c.var.role !== 'owner') throw new AppError(403, 'owner_only')
        const { email } = c.req.valid('param')
        tx(db, () => {
          if (!one(db, 'SELECT 1 AS x FROM admins WHERE email = ?', email)) throw new AppError(404, 'not_found')
          run(db, 'DELETE FROM admins WHERE email = ?', email)
          audit(db, c.var.user.email, 'staff_remove', email)
        })
        return c.json({ ok: true })
      })
      .get(
        '/audit',
        validate('query', z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) })),
        (c) =>
          c.json({
            entries: all<{ id: number; actor: string; action: string; target: string; reason: string; at: number }>(
              db,
              'SELECT * FROM audit ORDER BY id DESC LIMIT ?',
              c.req.valid('query').limit,
            ),
          }),
      )
      .get('/users', validate('query', UserQuery), (c) => {
        const { q, limit } = c.req.valid('query')
        const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
        const users = all<User>(
          db,
          `SELECT * FROM users
         WHERE email LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\' OR id LIKE ?1 ESCAPE '\\'
            OR near_account LIKE ?1 ESCAPE '\\'
         ORDER BY last_seen DESC LIMIT ?2`,
          like,
          limit,
        )
        return c.json({
          users: users.map((u) => ({
            id: u.id,
            email: u.email,
            nearAccount: u.near_account,
            name: u.name,
            credits: u.credits,
            banned: u.banned === 1,
            banReason: u.ban_reason,
            lastSeen: u.last_seen,
            createdAt: u.created_at,
          })),
        })
      })
  )
}

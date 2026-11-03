import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { type Identity, requireUser, type User } from './auth.ts'
import type { Config } from './config.ts'
import { all, type Db, one } from './db.ts'
import { AppError, validate } from './http.ts'

export type Role = 'owner' | 'admin' | 'viewer'
type AdminEnv = { Variables: { user: User; role: Role } }

// Roles come from the email Privy verified: owners from OWNER_EMAILS, the rest from the admins table.
export function roleOf(db: Db, cfg: Config, email: string): Role | undefined {
  if (!email) return undefined
  if (cfg.OWNER_EMAILS.includes(email)) return 'owner'
  return one<{ role: Role }>(db, 'SELECT role FROM admins WHERE email = ?', email)?.role
}

const UserQuery = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export function adminRoutes(deps: { cfg: Config; db: Db; identity: Identity }) {
  const { db, cfg } = deps
  return new Hono<AdminEnv>()
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
          lastSeen: u.last_seen,
          createdAt: u.created_at,
        })),
      })
    })
}

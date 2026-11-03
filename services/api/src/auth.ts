import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose'
import { z } from 'zod'
import { type Db, one, run } from './db.ts'
import { AppError } from './http.ts'

export type User = {
  id: string
  email: string
  near_account: string
  name: string
  credits: number
  banned: number
  ban_reason: string
  created_at: number
  last_seen: number
}
export type AppEnv = { Variables: { user: User } }

export type Profile = { email: string; nearAccount: string }
// Who is calling. Privy in production, a fake in tests.
export type Identity = {
  verify(token: string): Promise<string>
  profile(userId: string): Promise<Profile>
}

const PRIVY = 'https://auth.privy.io/api/v1'
// Implicit (64 hex) or named account, the rule NEAR uses.
const NEAR_ACCOUNT = /^(?:[0-9a-f]{64}|(?:(?:[a-z\d]+[-_])*[a-z\d]+\.)+(?:[a-z\d]+[-_])*[a-z\d]+)$/

// Docs: https://docs.privy.io/authentication/user-authentication/access-tokens
export function privyIdentity(
  appId: string,
  secret: string,
  opts: { jwks?: JWTVerifyGetKey; fetch?: typeof fetch } = {},
): Identity {
  // jose caches the keys and refetches on an unknown key id (rotation).
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${PRIVY}/apps/${encodeURIComponent(appId)}/jwks.json`))
  const doFetch = opts.fetch ?? fetch
  const basic = `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`
  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, jwks, { issuer: 'privy.io', audience: appId, algorithms: ['ES256'] })
      if (!payload.sub) throw new Error('token without subject')
      return payload.sub
    },
    async profile(userId) {
      const res = await doFetch(`${PRIVY}/users/${encodeURIComponent(userId)}`, {
        headers: { authorization: basic, 'privy-app-id': appId },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`privy users: ${res.status}`)
      return parseProfile(await res.json())
    },
  }
}

const PrivyUser = z.object({
  linked_accounts: z.array(
    z.looseObject({
      type: z.string(),
      address: z.string().optional(),
      email: z.string().optional(),
      chain_type: z.string().optional(),
    }),
  ),
})

// Email (email login first, then Google) and the NEAR wallet Privy created for the player.
export function parseProfile(raw: unknown): Profile {
  const accounts = PrivyUser.parse(raw).linked_accounts
  const email =
    accounts.find((a) => a.type === 'email')?.address ?? accounts.find((a) => a.type === 'google_oauth')?.email ?? ''
  const near = accounts.find((a) => a.type === 'wallet' && a.chain_type === 'near')?.address ?? ''
  return { email: email.trim().toLowerCase(), nearAccount: NEAR_ACCOUNT.test(near) ? near : '' }
}

export function getUser(db: Db, id: string): User | undefined {
  return one<User>(db, 'SELECT * FROM users WHERE id = ?', id)
}

// Every player route. Verifies the Privy token, creates the player on first sign-in and fills in the NEAR account
// once Privy has it (the wallet is created right after the first login).
export function requireUser(deps: { db: Db; identity: Identity }) {
  // ponytail: in-memory throttle on Privy lookups for players without a NEAR wallet yet; per process, fine for one api.
  const lookedUp = new Map<string, number>()
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = c.req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1]
    if (!token) throw new AppError(401, 'unauthorized')
    const id = await deps.identity.verify(token).catch(() => {
      throw new AppError(401, 'unauthorized')
    })
    const now = Date.now()
    let user = getUser(deps.db, id)
    if (!user || (!user.near_account && now - (lookedUp.get(id) ?? 0) > 30_000)) {
      lookedUp.set(id, now)
      const profile = await deps.identity.profile(id).catch((err: unknown) => {
        if (!user) throw new AppError(503, 'identity_unavailable')
        console.warn('privy profile lookup failed', err)
        return undefined
      })
      if (profile) user = saveProfile(deps.db, id, profile, now)
    }
    if (!user) throw new AppError(503, 'identity_unavailable')
    if (now - user.last_seen > 60_000) run(deps.db, 'UPDATE users SET last_seen = ? WHERE id = ?', now, id)
    c.set('user', user)
    await next()
  })
}

// Writes: banned players can still sign in and read, never change anything.
export const requireActive = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.user.banned) throw new AppError(403, 'banned')
  await next()
})

function saveProfile(db: Db, id: string, p: Profile, now: number): User {
  // The NEAR account is set once and never replaced: credits and units are tied to it.
  return one<User>(
    db,
    `INSERT INTO users (id, email, near_account, created_at, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE email END,
       near_account = CASE WHEN near_account = '' THEN excluded.near_account ELSE near_account END
     RETURNING *`,
    id,
    p.email,
    p.nearAccount,
    now,
    now,
  )!
}

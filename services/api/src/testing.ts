// Test helpers only (imported by *.test.ts, never by the server).
import { createHash } from 'node:crypto'
import { createApp } from './app.ts'
import type { Identity, Profile } from './auth.ts'
import { type Config, loadConfig } from './config.ts'
import { openDb, run } from './db.ts'

// Token "tok-alice" signs in as did:privy:alice with alice@test.io and a NEAR account derived from the id.
export function fakeIdentity(overrides: Partial<Record<string, Profile | 'down'>> = {}): Identity {
  return {
    async verify(token) {
      if (!token.startsWith('tok-')) throw new Error('bad token')
      return `did:privy:${token.slice(4)}`
    },
    async profile(userId) {
      const name = userId.split(':')[2]!
      const o = overrides[name]
      if (o === 'down') throw new Error('privy down')
      return o ?? { email: `${name}@test.io`, nearAccount: createHash('sha256').update(userId).digest('hex') }
    },
  }
}

export function testApp(env: Record<string, string> = {}, identity = fakeIdentity()) {
  const cfg: Config = loadConfig({ PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret', ...env })
  const db = openDb(':memory:')
  const app = createApp({ cfg, db, identity })
  const call = (method: string, path: string, token?: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  const ban = (name: string) => run(db, "UPDATE users SET banned = 1 WHERE id = 'did:privy:' || ?", name)
  return { app, db, cfg, call, ban }
}

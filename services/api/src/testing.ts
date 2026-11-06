// Test helpers only (imported by *.test.ts, never by the server).
import { createHash } from 'node:crypto'
import { createApp } from './app.ts'
import type { Identity, Profile } from './auth.ts'
import { type Config, loadConfig } from './config.ts'
import { openDb, run } from './db.ts'
import type { Relayer } from './near.ts'
import type { Quotes } from './quotes.ts'

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

// Fixed prices: TSLA $400, NVDA $200, SPY $600.
export const fakeQuotes: Quotes = {
  async latest() {
    const q = (usd: number) => ({ usd, change24h: 0, liquidityUsd: 1_000_000 })
    return { at: 0, stale: false, prices: { tsla: q(400), nvda: q(200), spy: q(600) } }
  },
  async spot(id) {
    return (await this.latest()).prices[id]!.usd
  },
}

// Records what the api asked the relayer to do; `failRelay` makes the next relay land with a failure, `failTransfer`
// the next ft_transfer. `balances` holds NEP-141 balances as `${token}:${account}`.
export function fakeRelayer() {
  const accounts = new Set<string>()
  const registered = new Set<string>()
  const balances = new Map<string, bigint>()
  const calls: string[] = []
  let failNext = false
  let failTransferNext = false
  const relayer: Relayer = {
    async relay(d) {
      calls.push(`relay:${d.delegateAction.receiverId}:${d.delegateAction.actions[0]?.functionCall?.methodName}`)
      if (failNext) {
        failNext = false
        return { hash: 'tx-failed', ok: false, error: 'ActionError' }
      }
      return { hash: 'tx-ok', ok: true }
    },
    async accountExists(id) {
      return accounts.has(id)
    },
    async createImplicit(id) {
      calls.push(`create:${id}`)
      accounts.add(id)
      return 'tx-create'
    },
    async isRegistered(token, id) {
      return registered.has(`${token}:${id}`)
    },
    async register(token, id) {
      calls.push(`register:${id}`)
      registered.add(`${token}:${id}`)
      return 'tx-register'
    },
    async ftBalance(token, id) {
      return balances.get(`${token}:${id}`) ?? 0n
    },
    async ftTransfer(token, to, amount) {
      calls.push(`ft_transfer:${to}:${amount}`)
      if (failTransferNext) {
        failTransferNext = false
        return { hash: 'tx-ft-failed', ok: false, error: 'ActionError' }
      }
      return { hash: 'tx-ft', ok: true }
    },
  }
  return {
    relayer,
    calls,
    balances,
    failRelay: () => (failNext = true),
    failTransfer: () => (failTransferNext = true),
  }
}

export function testApp(
  env: Record<string, string> = {},
  identity = fakeIdentity(),
  quotes = fakeQuotes,
  relayer?: Relayer,
) {
  const cfg: Config = loadConfig({ PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret', ...env })
  const db = openDb(':memory:')
  const app = createApp({ cfg, db, identity, quotes, relayer })
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

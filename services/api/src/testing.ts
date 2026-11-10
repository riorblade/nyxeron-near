// Test helpers only (imported by *.test.ts, never by the server).
import { createHash } from 'node:crypto'
import { createApp } from './app.ts'
import type { Identity, Profile } from './auth.ts'
import { type Config, loadConfig } from './config.ts'
import { openDb, run } from './db.ts'
import type { OneClick } from './intents.ts'
import type { Relayer } from './near.ts'
import type { Quotes } from './quotes.ts'
import type { Owed, SettleChain } from './settlement.ts'

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
// the next ft_transfer. `balances` holds NEP-141 balances as `${token}:${account}`, `registered` storage registrations
// as `${token}:${account}`. Like a real NEP-141 token, a relayed ft_transfer to an unregistered account fails.
export function fakeRelayer() {
  const accounts = new Set<string>()
  const registered = new Set<string>()
  const balances = new Map<string, bigint>()
  const calls: string[] = []
  let failNext = false
  let failTransferNext = false
  const relayer: Relayer = {
    async relay(d) {
      const call = d.delegateAction.actions[0]?.functionCall
      calls.push(`relay:${d.delegateAction.receiverId}:${call?.methodName}`)
      if (failNext) {
        failNext = false
        return { hash: 'tx-failed', ok: false, error: 'ActionError' }
      }
      if (call?.methodName === 'ft_transfer') {
        const to = (JSON.parse(Buffer.from(call.args).toString('utf8')) as { receiver_id: string }).receiver_id
        if (!registered.has(`${d.delegateAction.receiverId}:${to}`))
          return { hash: 'tx-unregistered', ok: false, error: `The account ${to} is not registered` }
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
    registered,
    failRelay: () => (failNext = true),
    failTransfer: () => (failTransferNext = true),
  }
}

export function testApp(
  env: Record<string, string> = {},
  identity = fakeIdentity(),
  quotes = fakeQuotes,
  relayer?: Relayer,
  oneclick?: OneClick,
) {
  const cfg: Config = loadConfig({ PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret', ...env })
  const db = openDb(':memory:')
  const app = createApp({ cfg, db, identity, quotes, relayer, oneclick })
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

// The contract's settlement side in memory: pots, owed, used proofs, settled op ids. `fail(method)` makes the next call
// to it throw; `landThenThrow(method)` applies it on chain but loses the answer (a timeout).
export function fakeChain(owedByParty: Record<string, Owed[]>) {
  const pots = new Map<string, { held: string; released: boolean }>(
    Object.entries(owedByParty)
      .filter(([, o]) => o.length)
      .map(([p]) => [p, { held: '410000', released: false }]),
  )
  const owed = new Map(Object.entries(owedByParty).map(([p, o]) => [p, o.map((x) => ({ ...x }))]))
  const proofs = new Set<string>()
  const settled = new Set<string>()
  const minted = new Map<string, bigint>()
  const calls: string[] = []
  const failing = new Map<string, 'throw' | 'land'>()
  const guard = (method: string, apply: () => void) => {
    const f = failing.get(method)
    failing.delete(method)
    if (f === 'throw') throw new Error(`${method} rpc timeout`)
    apply()
    if (f === 'land') throw new Error(`${method} answer lost`)
    return `tx-${method}-${calls.length}`
  }
  const chain: SettleChain = {
    async release(party) {
      calls.push(`release:${party}`)
      return guard('release', () => {
        const pot = pots.get(party) ?? { held: '0', released: false }
        if (pot.released && pot.held === '0') throw new Error('already released')
        pots.set(party, { held: '0', released: true })
      })
    },
    async mint(token, units, proof) {
      calls.push(`mint:${token}:${units}:${proof}`)
      return guard('mint', () => {
        if (proofs.has(proof)) throw new Error('proof already used')
        proofs.add(proof)
        minted.set(token, (minted.get(token) ?? 0n) + units)
      })
    },
    async settle(party, opId, transfers) {
      calls.push(`settle:${opId}:${transfers.length}`)
      return guard('settle', () => {
        if (settled.has(opId)) throw new Error('op_id already settled')
        settled.add(opId)
        const rows = owed.get(party) ?? []
        for (const t of transfers) {
          const i = rows.findIndex((r) => r.account_id === t.account_id && r.token_id === t.token_id)
          if (i < 0 || BigInt(rows[i]!.qty) < BigInt(t.amount)) throw new Error('more than owed')
          rows.splice(i, 1)
        }
      })
    },
    async owed(party) {
      return owed.get(party) ?? []
    },
    async pot(party) {
      return pots.get(party) ?? { held: '0', released: false }
    },
    async isUsedProof(proof) {
      return proofs.has(proof)
    },
    async isSettled(opId) {
      return settled.has(opId)
    },
  }
  return {
    chain,
    calls,
    minted,
    sends: () => calls.filter((c) => !c.startsWith('view')),
    fail: (m: string) => failing.set(m, 'throw'),
    landThenThrow: (m: string) => failing.set(m, 'land'),
  }
}

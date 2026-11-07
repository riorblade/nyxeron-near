import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.ts'
import { all, openDb, run } from './db.ts'
import {
  backoff,
  buySharesFor,
  chainParty,
  GRACE_MS,
  MAX_ATTEMPTS,
  MAX_KEY_LEN,
  MAX_PROOF_LEN,
  nextOp,
  type OpRow,
  type Owed,
  planOps,
  retryOp,
  type SettleChain,
  settlement,
  settlementView,
} from './settlement.ts'
import { fakeIdentity, fakeQuotes, testApp } from './testing.ts'

const guest = (n: number) => `${String(n).padStart(2, '0')}`.repeat(32)
const owedRow = (n: number, token: string, qty: number): Owed => ({
  account_id: guest(n),
  token_id: token,
  qty: String(qty),
})

// The contract's settlement side in memory: pots, owed, used proofs, settled op ids. `fail(method)` makes the next call
// to it throw; `landThenThrow(method)` applies it on chain but loses the answer (a timeout).
function fakeChain(owedByParty: Record<string, Owed[]>) {
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

function world(owedByParty: Record<string, Owed[]>, endsAt = 1_000) {
  const db = openDb(':memory:')
  run(db, "INSERT INTO users (id, created_at, last_seen) VALUES ('host', 0, 0)")
  for (const id of Object.keys(owedByParty))
    run(
      db,
      "INSERT INTO parties (id, host_id, title, seed, starts_at, ends_at, created_at) VALUES (?, 'host', 'P', 1, 0, ?, 0)",
      Number(id),
      endsAt,
    )
  run(db, "UPDATE meta SET value = 't' WHERE key = 'install'") // chain party ids read t-<id>
  const fake = fakeChain(Object.fromEntries(Object.entries(owedByParty).map(([id, o]) => [`t-${id}`, o])))
  let t = endsAt + GRACE_MS
  const cfg = loadConfig({ PRIVY_APP_ID: 'a', PRIVY_APP_SECRET: 's' })
  const job = settlement({ db, chain: fake.chain, buyShares: buySharesFor(cfg), now: () => t })
  const runAll = async (max = 50) => {
    for (let i = 0; i < max; i++) await job.tick()
  }
  const status = (party: number) =>
    all<{ status: string }>(db, 'SELECT status FROM settlements WHERE party_id = ?', party)[0]?.status
  const ops = (party: number) => all<OpRow>(db, 'SELECT * FROM chain_ops WHERE party_id = ? ORDER BY seq', party)
  return {
    db,
    fake,
    job,
    runAll,
    status,
    ops,
    advance: (ms: number) => (t += ms),
    at: () => t,
  }
}

describe('planOps', () => {
  it('mints each token once for the total owed, then settles in batches of 32 sorted by guest and token', () => {
    const owed = [
      ...Array.from({ length: 40 }, (_, i) => owedRow(i, 'tsla', 1)),
      ...Array.from({ length: 30 }, (_, i) => owedRow(i, 'nvda', 2)),
    ]
    const ops = planOps('t-7', owed)
    expect(ops.map((o) => o.id)).toEqual([
      'mint:t-7:nvda',
      'mint:t-7:tsla',
      'party:t-7:1',
      'party:t-7:2',
      'party:t-7:3',
    ])
    expect(ops[0]!.payload).toEqual({ token: 'nvda', units: '60' })
    expect(ops[1]!.payload).toEqual({ token: 'tsla', units: '40' })
    const batches = ops.slice(2).map((o) => (o.payload as { transfers: unknown[] }).transfers.length)
    expect(batches).toEqual([32, 32, 6])
    expect(ops.map((o) => o.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('has nothing to do for a party nobody bought at', () => {
    expect(planOps('t-1', [])).toEqual([])
  })

  it('keeps ids and proofs inside the contract limits', async () => {
    const big = 2 ** 31
    // the longest chain party: 8 hex chars of install id, a dash, the biggest party id
    for (const op of planOps(`ffffffff-${big}`, [owedRow(1, 'googl', 1)]))
      expect(op.id.length).toBeLessThanOrEqual(MAX_KEY_LEN)
    const proof = await buySharesFor(loadConfig({ PRIVY_APP_ID: 'a', PRIVY_APP_SECRET: 's' }))(String(big), 'googl', 1n)
    expect(proof).toBe(`demo:${big}:googl:1`)
    expect(proof.length).toBeLessThanOrEqual(MAX_PROOF_LEN)
  })
})

describe('nextOp', () => {
  const op = (seq: number, status: OpRow['status'], nextAt = 0) =>
    ({ id: `o${seq}`, seq, status, next_at: nextAt }) as OpRow
  it('runs the first unfinished op once it is due, waits otherwise, stops at a failure, and ends when all are done', () => {
    expect(nextOp([op(0, 'done'), op(1, 'pending')], 5)).toMatchObject({ kind: 'run', op: { id: 'o1' } })
    expect(nextOp([op(1, 'pending', 10), op(0, 'done')], 5)).toEqual({ kind: 'wait' })
    expect(nextOp([op(0, 'sent')], 5)).toMatchObject({ kind: 'run', op: { id: 'o0' } })
    expect(nextOp([op(0, 'done'), op(1, 'failed'), op(2, 'pending')], 5)).toMatchObject({ kind: 'failed' })
    expect(nextOp([op(0, 'done'), op(1, 'done')], 5)).toEqual({ kind: 'done' })
  })
  it('backs off 15 s, 30 s, 60 s … up to 10 minutes', () => {
    expect([1, 2, 3].map(backoff)).toEqual([15_000, 30_000, 60_000])
    expect(backoff(20)).toBe(600_000)
  })
})

describe('the settlement job', () => {
  it('releases, mints each token, settles every guest, in that order, one transaction per tick', async () => {
    const w = world({ 7: [owedRow(1, 'tsla', 3), owedRow(2, 'tsla', 1), owedRow(2, 'nvda', 2)] })
    await w.job.tick()
    expect(w.fake.calls).toEqual(['release:t-7'])
    await w.runAll()
    expect(w.fake.calls).toEqual([
      'release:t-7',
      'mint:nvda:2:demo:t-7:nvda:1',
      'mint:tsla:4:demo:t-7:tsla:1',
      'settle:party:t-7:1:3',
    ])
    expect(w.status(7)).toBe('done')
    expect(await w.fake.chain.owed('7')).toEqual([])
    expect(w.ops(7).every((o) => o.status === 'done' && o.tx_hash)).toBe(true)
  })

  it('waits out the grace period after the party ends', async () => {
    const w = world({ 3: [owedRow(1, 'tsla', 1)] })
    w.advance(-1)
    await w.job.tick()
    expect(w.fake.calls).toEqual([])
    w.advance(1)
    await w.job.tick()
    expect(w.fake.calls).toEqual(['release:t-3'])
  })

  it('a party nobody bought at has no pot: done without a release, a mint or a settle', async () => {
    const w = world({ 4: [] })
    await w.runAll()
    expect(w.fake.calls).toEqual([])
    expect(w.status(4)).toBe('done')
  })

  it('a release whose USDC transfer bounced (pot put back) is retried, not taken as done', async () => {
    const w = world({ 12: [owedRow(1, 'tsla', 1)] })
    const release = w.fake.chain.release
    let bounced = false
    w.fake.chain.release = async (party) => {
      if (bounced) return release(party)
      bounced = true
      return 'tx-bounced' // the call "succeeds" but the pot stays held
    }
    await w.job.tick()
    expect(w.ops(12)[0]).toMatchObject({ kind: 'release', status: 'pending', error: 'release_not_landed' })
    w.advance(60_000)
    await w.runAll()
    expect(w.status(12)).toBe('done')
    expect(w.fake.minted.get('tsla')).toBe(1n)
  })

  it("chain ids carry this database's install id, so a fresh database never reuses a party, op id or proof", () => {
    const a = openDb(':memory:')
    const b = openDb(':memory:')
    expect(chainParty(a, 1)).toMatch(/^[0-9a-f]{8}-1$/)
    expect(chainParty(a, 1)).not.toBe(chainParty(b, 1))
  })

  it('retries a failed call after its backoff, never before', async () => {
    const w = world({ 5: [owedRow(1, 'spy', 1)] })
    w.fake.fail('release')
    await w.job.tick()
    expect(w.ops(5)[0]).toMatchObject({ status: 'pending', attempts: 1 })
    await w.job.tick()
    expect(w.fake.calls).toEqual(['release:t-5']) // still backing off
    w.advance(backoff(1))
    await w.runAll()
    expect(w.status(5)).toBe('done')
  })

  it(`stops the party after ${MAX_ATTEMPTS} failures, and an admin retry resumes it`, async () => {
    const w = world({ 6: [owedRow(1, 'tsla', 1)] })
    await w.job.tick() // release
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      w.fake.fail('mint')
      await w.job.tick()
      w.advance(10 * 60_000)
    }
    expect(w.status(6)).toBe('failed')
    const before = w.fake.calls.length
    await w.runAll()
    expect(w.fake.calls.length).toBe(before) // a failed party sends nothing more
    expect(retryOp(w.db, 'mint:t-6:tsla', w.at())).toBe(true)
    await w.runAll()
    expect(w.status(6)).toBe('done')
    expect(w.fake.minted.get('tsla')).toBe(1n)
  })

  it('an answer lost after the call landed is found on chain: never minted or settled twice', async () => {
    const w = world({ 8: [owedRow(1, 'aapl', 2)] })
    await w.job.tick() // release
    w.fake.landThenThrow('mint')
    await w.job.tick()
    expect(w.ops(8).find((o) => o.kind === 'mint')).toMatchObject({ status: 'pending', attempts: 1 })
    w.fake.landThenThrow('settle')
    w.advance(backoff(1))
    await w.runAll(5)
    w.advance(backoff(1))
    await w.runAll()
    expect(w.fake.calls.filter((c) => c.startsWith('mint'))).toHaveLength(1)
    expect(w.fake.calls.filter((c) => c.startsWith('settle'))).toHaveLength(1)
    expect(w.fake.minted.get('aapl')).toBe(2n)
    expect(w.status(8)).toBe('done')
  })

  it('resumes after a crash mid-send: an op left "sent" is checked on chain first', async () => {
    const w = world({ 9: [owedRow(1, 'qqq', 1)] })
    await w.runAll()
    const calls = w.fake.calls.length
    // Pretend we crashed after the settle landed but before it was marked done.
    run(w.db, "UPDATE chain_ops SET status = 'sent', tx_hash = '' WHERE id = 'party:t-9:1'")
    run(w.db, "UPDATE settlements SET status = 'pending' WHERE party_id = 9")
    await w.runAll()
    expect(w.fake.calls.length).toBe(calls) // nothing resent
    expect(w.status(9)).toBe('done')
  })

  it('a done op is never sent again', async () => {
    const w = world({ 10: [owedRow(1, 'meta', 1)] })
    await w.runAll()
    const calls = w.fake.calls.length
    await w.runAll()
    expect(w.fake.calls.length).toBe(calls)
  })

  it('on mainnet without a warehouse account the party stops at its first mint, nothing minted', async () => {
    const db = openDb(':memory:')
    run(db, "INSERT INTO users (id, created_at, last_seen) VALUES ('host', 0, 0)")
    run(
      db,
      "INSERT INTO parties (id, host_id, title, seed, starts_at, ends_at, created_at) VALUES (1, 'host', 'P', 1, 0, 0, 0)",
    )
    const fake = fakeChain({ [chainParty(db, 1)]: [owedRow(1, 'tsla', 1)] })
    const cfg = loadConfig({
      PRIVY_APP_ID: 'a',
      PRIVY_APP_SECRET: 's',
      NEAR_NETWORK: 'mainnet',
      CONTRACT_ID: 'nyxeron.near',
    })
    const job = settlement({ db, chain: fake.chain, buyShares: buySharesFor(cfg), now: () => GRACE_MS + 1 })
    for (let i = 0; i < 5; i++) await job.tick()
    expect(fake.calls).toEqual([`release:${chainParty(db, 1)}`])
    expect(all(db, "SELECT error FROM chain_ops WHERE kind = 'mint'")).toEqual([{ error: 'not_built' }])
  })

  it('on mainnet with the warehouse buyer, its swap hash is the mint proof', async () => {
    const db = openDb(':memory:')
    run(db, "INSERT INTO users (id, created_at, last_seen) VALUES ('host', 0, 0)")
    run(
      db,
      "INSERT INTO parties (id, host_id, title, seed, starts_at, ends_at, created_at) VALUES (1, 'host', 'P', 1, 0, 0, 0)",
    )
    const party = chainParty(db, 1)
    const fake = fakeChain({ [party]: [owedRow(1, 'tsla', 3)] })
    const cfg = loadConfig({ PRIVY_APP_ID: 'a', PRIVY_APP_SECRET: 's', NEAR_NETWORK: 'mainnet', CONTRACT_ID: 'x.near' })
    const bought: string[] = []
    const buy = async (p: string, token: string, units: bigint) => {
      bought.push(`${p}:${token}:${units}`)
      return '0xswap'
    }
    const job = settlement({ db, chain: fake.chain, buyShares: buySharesFor(cfg, buy), now: () => GRACE_MS + 1 })
    for (let i = 0; i < 5; i++) await job.tick()
    expect(bought).toEqual([`${party}:tsla:3`])
    expect(fake.calls).toContain('mint:tsla:3:0xswap')
  })
})

describe('GET /api/parties/:id/settlement and the admin view', () => {
  it('says live, waiting, then shows every step with its hash', async () => {
    const t = testApp({ OWNER_ACCOUNT_ID: 'owner.testnet', OWNER_KEY: 'ed25519:x' }, fakeIdentity(), fakeQuotes)
    const created = await t.call('POST', '/api/parties', 'tok-host', { title: 'Night', minutes: 5 })
    const { id } = (await created.json()) as { id: number }
    const view = async () => (await t.call('GET', `/api/parties/${id}/settlement`, 'tok-guest')).json()
    expect(await view()).toEqual({ status: 'live', ops: [] })
    run(t.db, 'UPDATE parties SET ends_at = 0 WHERE id = ?', id)
    expect(await view()).toEqual({ status: 'waiting', ops: [] })
    const fake = fakeChain({ [chainParty(t.db, id)]: [owedRow(1, 'tsla', 2)] })
    const job = settlement({ db: t.db, chain: fake.chain, buyShares: buySharesFor(t.cfg), now: () => GRACE_MS + 1 })
    for (let i = 0; i < 5; i++) await job.tick()
    expect(await view()).toEqual({
      status: 'done',
      ops: [
        { kind: 'release', hash: expect.any(String), status: 'done' },
        { kind: 'mint', token: 'tsla', units: '2', hash: expect.any(String), status: 'done' },
        { kind: 'settle', units: '2', hash: expect.any(String), status: 'done' },
      ],
    })
  })

  it('is off without an owner key; failed steps are listed for the back office and an admin can retry them', async () => {
    const t = testApp({ OWNER_EMAILS: 'boss@test.io' }, fakeIdentity(), fakeQuotes)
    const created = await t.call('POST', '/api/parties', 'tok-host', { title: 'Night', minutes: 5 })
    const { id } = (await created.json()) as { id: number }
    run(t.db, 'UPDATE parties SET ends_at = 0 WHERE id = ?', id)
    expect(await (await t.call('GET', `/api/parties/${id}/settlement`, 'tok-guest')).json()).toMatchObject({
      status: 'off',
    })
    run(t.db, "INSERT INTO settlements (party_id, status, error, updated_at) VALUES (?, 'failed', 'x', 0)", id)
    run(
      t.db,
      `INSERT INTO chain_ops (id, party_id, seq, kind, payload, status, attempts, next_at, error, updated_at)
       VALUES (?, ?, 0, 'release', '{}', 'failed', 5, 0, 'rpc timeout', 0)`,
      `release:${id}`,
      id,
    )
    const list = (await (await t.call('GET', '/api/admin/settlement', 'tok-boss')).json()) as { failed: unknown[] }
    expect(list.failed).toEqual([
      { id: `release:${id}`, party: id, kind: 'release', attempts: 5, error: 'rpc timeout', updatedAt: 0 },
    ])
    expect((await t.call('POST', `/api/admin/settlement/release:${id}/retry`, 'tok-guest')).status).toBe(403)
    expect((await t.call('POST', `/api/admin/settlement/release:${id}/retry`, 'tok-boss')).status).toBe(200)
    expect((await t.call('POST', `/api/admin/settlement/release:${id}/retry`, 'tok-boss')).status).toBe(404)
    expect(settlementView(t.db, { id, ends_at: 0 }, false).status).toBe('pending')
  })
})

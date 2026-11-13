import { describe, expect, it } from 'vitest'
import { run } from './db.ts'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { hoodTestnet } from './hoodnet.ts'
import { type ProofSource, shares } from './proof.ts'
import { chainParty } from './settlement.ts'
import { fakeIdentity, fakeQuotes } from './testing.ts'

const E15 = 10n ** 15n // one unit, 0.001 share, in 18 decimals

function setup(env: Record<string, string>, proof?: ProofSource) {
  const cfg = loadConfig({ PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret', ...env })
  const db = openDb(':memory:')
  const app = createApp({ cfg, db, identity: fakeIdentity(), quotes: fakeQuotes, proof })
  return { db, get: async (path: string) => app.request(path) }
}

describe('GET /api/proof (public)', () => {
  it('testnet: units on the contract, labelled demo, no warehouse', async () => {
    const supply = { tsla: 6n, nvda: 0n } as Record<string, bigint>
    const { get } = setup({}, { supply: async (t) => supply[t] ?? 0n })
    const res = await get('/api/proof')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ network: 'testnet', contractId: 'nyxeron.testnet', demo: true, warehouse: null })
    expect(body.hood).toMatchObject({ chainId: 4663, synthetic: false })
    expect(body.tokens).toEqual([
      expect.objectContaining({ token: 'tsla', units: '6', sharesOwed: '0.006', sharesHeld: null, backed: null }),
    ])
  })

  it('testnet with the synthetic market: the warehouse holds synthetic stocks, labelled so, not demo', async () => {
    const net = hoodTestnet({
      usdg: `0x${'01'.repeat(20)}`,
      market: `0x${'02'.repeat(20)}`,
      tokens: Object.fromEntries(
        ['tsla', 'nvda', 'aapl', 'googl', 'meta', 'msft', 'spy', 'qqq', 'crcl', 'mstr'].map((id, i) => [
          id,
          `0x${(i + 16).toString(16).repeat(20)}`,
        ]),
      ) as never,
    })!
    const held: Record<string, bigint> = { [net.tokens.tsla]: 6n * E15 }
    const { get } = setup(
      {},
      {
        supply: async (t) => (t === 'tsla' ? 6n : 0n),
        warehouse: { address: async () => '0xabc', sharesUi: async (a) => held[a] ?? 0n, net },
      },
    )
    const body = (await (await get('/api/proof')).json()) as Record<string, unknown>
    expect(body).toMatchObject({ network: 'testnet', demo: false, warehouse: '0xabc' })
    expect(body.hood).toMatchObject({ chainId: 46630, synthetic: true, explorer: net.explorer })
    expect(body.tokens).toEqual([
      expect.objectContaining({ token: 'tsla', address: net.tokens.tsla, sharesHeld: '0.006', backed: true }),
    ])
  })

  it('mainnet: the warehouse holds at least what the units stand for, or says it does not', async () => {
    const held: Record<string, bigint> = { '0x322F0929c4625eD5bAd873c95208D54E1c003b2d': 7n * E15 }
    const { get } = setup(
      { NEAR_NETWORK: 'mainnet', CONTRACT_ID: 'nyxeron.near' },
      {
        supply: async (t) => (t === 'tsla' ? 6n : t === 'nvda' ? 2n : 0n),
        warehouse: { address: async () => '0xabc', sharesUi: async (a) => held[a] ?? 0n },
      },
    )
    const body = (await (await get('/api/proof')).json()) as { demo: boolean; warehouse: string; tokens: object[] }
    expect(body.demo).toBe(false)
    expect(body.warehouse).toBe('0xabc')
    expect(body.tokens).toEqual([
      expect.objectContaining({ token: 'tsla', sharesOwed: '0.006', sharesHeld: '0.007', backed: true }),
      expect.objectContaining({ token: 'nvda', sharesOwed: '0.002', sharesHeld: '0', backed: false }),
    ])
  })
})

describe('GET /api/proof/parties/:chainParty (public)', () => {
  it("shows a party's steps with each mint's proof, and only this database's parties", async () => {
    const { db, get } = setup({ OWNER_ACCOUNT_ID: 'owner.testnet', OWNER_KEY: 'ed25519:' + 'x'.repeat(40) }, undefined)
    run(db, "INSERT INTO users (id, created_at, last_seen) VALUES ('h', 0, 0)")
    run(
      db,
      "INSERT INTO parties (id, host_id, title, seed, starts_at, ends_at, created_at) VALUES (5, 'h', 'Friday', 1, 0, 1, 0)",
    )
    run(db, "INSERT INTO settlements (party_id, status, updated_at) VALUES (5, 'done', 0)")
    const cp = chainParty(db, 5)
    const ops = [
      ['release', {}, 'h1'],
      ['mint', { token: 'tsla', units: '3', proof: `demo:${cp}:tsla:1` }, 'h2'],
      ['settle', { transfers: [{ account_id: 'g.testnet', token_id: 'tsla', amount: '3' }] }, 'h3'],
    ] as const
    ops.forEach(([kind, payload, hash], i) =>
      run(
        db,
        "INSERT INTO chain_ops (id, party_id, seq, kind, payload, status, tx_hash, attempts, next_at, updated_at) VALUES (?, 5, ?, ?, ?, 'done', ?, 1, 0, 0)",
        `op${i}`,
        i,
        kind,
        JSON.stringify(payload),
        hash,
      ),
    )
    const res = await get(`/api/proof/parties/${cp}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      chainParty: cp,
      title: 'Friday',
      endsAt: 1,
      status: 'done',
      steps: [
        { kind: 'release', hash: 'h1', status: 'done' },
        { kind: 'mint', token: 'tsla', units: '3', hash: 'h2', status: 'done', proof: `demo:${cp}:tsla:1` },
        { kind: 'settle', units: '3', hash: 'h3', status: 'done' },
      ],
    })
    expect((await get('/api/proof/parties/ffffffff-5')).status).toBe(404)
    expect((await get('/api/proof/parties/nope')).status).toBe(404)
    expect((await (await get('/api/proof')).json()) as { recent: object[] }).toMatchObject({
      recent: [{ chainParty: cp, title: 'Friday', status: 'done' }],
    })
  })
})

it('shares: 18 decimals to a short decimal string', () => {
  expect(shares(0n)).toBe('0')
  expect(shares(3n * E15)).toBe('0.003')
  expect(shares(10n ** 18n + 5n * E15)).toBe('1.005')
})

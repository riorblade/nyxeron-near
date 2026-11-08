import { describe, expect, it, vi } from 'vitest'
import { all } from './db.ts'
import { fakeIdentity, fakeQuotes, fakeRelayer, testApp } from './testing.ts'

const USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'
const FAUCET = 'faucet.testnet'
const env = { DEMO_MODE: 'true', RELAYER_ACCOUNT_ID: FAUCET, RELAYER_KEY: 'ed25519:x' }

function setup(opts: { env?: Record<string, string>; faucet?: bigint; relayer?: boolean } = {}) {
  const fake = fakeRelayer()
  fake.balances.set(`${USDC}:${FAUCET}`, opts.faucet ?? 100_000_000n)
  const t = testApp(opts.env ?? env, fakeIdentity(), fakeQuotes, opts.relayer === false ? undefined : fake.relayer)
  const grant = async () => {
    const res = await t.call('POST', '/api/me/test-dollars', 'tok-judge')
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  const onboard = () => t.call('POST', '/api/onboard', 'tok-judge')
  return { ...t, fake, grant, onboard }
}

describe('POST /api/me/test-dollars', () => {
  it('sends the configured amount of testnet USDC to an onboarded player, once a day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { grant, onboard, fake, db } = setup()
      await onboard()
      const first = await grant()
      expect(first).toEqual({ status: 200, body: { hash: 'tx-ft', amount: 3_000_000 } })
      const account = all<{ near_account: string }>(db, 'SELECT near_account FROM users')[0]!.near_account
      expect(fake.calls).toContain(`ft_transfer:${account}:3000000`)
      expect(await grant()).toMatchObject({ status: 429, body: { error: 'too_soon' } })
      vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1)
      expect((await grant()).status).toBe(200)
      expect(fake.calls.filter((c) => c.startsWith('ft_transfer')).length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('needs the account registered on USDC first, and lets the player try again after onboarding', async () => {
    const { grant, onboard, fake } = setup()
    await grant() // creates the player
    expect(await grant()).toMatchObject({ status: 409, body: { error: 'not_onboarded' } })
    expect(fake.calls.some((c) => c.startsWith('ft_transfer'))).toBe(false)
    await onboard()
    expect((await grant()).status).toBe(200)
  })

  it('says the faucet is empty instead of sending, and a failed transfer can be retried', async () => {
    const empty = setup({ faucet: 1n })
    await empty.onboard()
    expect(await empty.grant()).toMatchObject({ status: 503, body: { error: 'faucet_empty' } })

    const flaky = setup()
    await flaky.onboard()
    flaky.fake.failTransfer()
    expect(await flaky.grant()).toMatchObject({ status: 502, body: { error: 'faucet_failed' } })
    expect((await flaky.grant()).status).toBe(200)
    expect(all<{ status: string }>(flaky.db, 'SELECT status FROM test_dollars ORDER BY id')).toEqual([
      { status: 'failed' },
      { status: 'sent' },
    ])
  })

  it('is off without DEMO_MODE, without a relayer, and never on mainnet', async () => {
    expect(await setup({ env: { RELAYER_ACCOUNT_ID: FAUCET, RELAYER_KEY: 'ed25519:x' } }).grant()).toMatchObject({
      status: 403,
      body: { error: 'demo_off' },
    })
    expect(await setup({ env: { DEMO_MODE: 'true' }, relayer: false }).grant()).toMatchObject({
      status: 503,
      body: { error: 'faucet_off' },
    })
    const mainnet = setup({
      env: {
        NEAR_NETWORK: 'mainnet',
        CONTRACT_ID: 'nyxeron.near',
        RELAYER_ACCOUNT_ID: FAUCET,
        RELAYER_KEY: 'ed25519:x',
      },
    })
    expect(await mainnet.grant()).toMatchObject({ status: 403, body: { error: 'not_testnet' } })
  })
})

describe('GET /api/config test dollars', () => {
  it('shows the amount and the faucet balance on testnet with DEMO_MODE, nothing otherwise', async () => {
    const on = await (await setup({ faucet: 42_000_000n }).call('GET', '/api/config')).json()
    expect(on).toMatchObject({ testDollars: { amount: 3_000_000, faucetBalance: 42_000_000 } })
    const off = await (await setup({ env: {} }).call('GET', '/api/config')).json()
    expect(off).toMatchObject({ testDollars: null })
  })
})

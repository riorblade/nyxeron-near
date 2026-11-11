import { createHash } from 'node:crypto'
import {
  type Action,
  actions,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  KeyPair,
  keyToImplicitAddress,
} from 'near-api-js'
import { describe, expect, it } from 'vitest'
import { all } from './db.ts'
import { fakeIdentity, fakeQuotes, fakeRelayer, testApp } from './testing.ts'

const CONTRACT = 'nyxeron.testnet'
const USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'
const TGAS = 1_000_000_000_000n

const alice = KeyPair.fromRandom('ed25519')
const aliceAccount = keyToImplicitAddress(alice.getPublicKey())

// A delegate signed for real, encoded the way the browser sends it (spike 19).
function wire(opts: {
  key?: KeyPair
  sender?: string
  receiver?: string
  actions?: Action[]
  method?: string
  args?: object
  deposit?: bigint
  gas?: bigint
}) {
  const key = opts.key ?? alice
  const delegateAction = buildDelegateAction({
    senderId: opts.sender ?? aliceAccount,
    receiverId: opts.receiver ?? USDC,
    nonce: 1n,
    maxBlockHeight: 1_000n,
    publicKey: key.getPublicKey(),
    actions: opts.actions ?? [
      actions.functionCall(
        opts.method ?? 'ft_transfer_call',
        opts.args ?? { receiver_id: CONTRACT, amount: '410000', msg: '{}' },
        opts.gas ?? 100n * TGAS,
        opts.deposit ?? 1n,
      ),
    ],
  })
  const hash = createHash('sha256').update(encodeDelegateAction(delegateAction)).digest()
  const signature = { ed25519Signature: { data: key.sign(hash).signature } }
  return Buffer.from(encodeSignedDelegate({ delegateAction, signature } as never)).toString('base64')
}

function setup(profiles = { alice: { email: 'alice@test.io', nearAccount: aliceAccount } }) {
  const fake = fakeRelayer()
  const t = testApp({}, fakeIdentity(profiles), undefined, fake.relayer)
  const relay = (signedDelegate: string, token = 'tok-alice') => t.call('POST', '/api/relay', token, { signedDelegate })
  return { ...t, ...fake, relay }
}

const refusal = async (res: Response) => ({ status: res.status, body: await res.json() })

describe('POST /api/relay', () => {
  it('relays a drink payment: USDC ft_transfer_call to our contract with 1 yocto', async () => {
    const { relay, calls, db } = setup()
    const res = await relay(wire({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hash: 'tx-ok', ok: true })
    expect(calls).toEqual([`relay:${USDC}:ft_transfer_call`])
    expect(all(db, 'SELECT receiver, method, tx_hash, ok FROM relays')).toEqual([
      { receiver: USDC, method: 'ft_transfer_call', tx_hash: 'tx-ok', ok: 1 },
    ])
  })

  it('relays claim_margin on our contract with no deposit', async () => {
    const { relay } = setup()
    expect((await relay(wire({ receiver: CONTRACT, method: 'claim_margin', args: {}, deposit: 0n }))).status).toBe(200)
  })

  const cases: [string, Parameters<typeof wire>[0], string][] = [
    ['someone else as sender', { sender: 'bob.testnet' }, 'wrong_sender'],
    ['another contract', { receiver: 'evil.testnet' }, 'receiver_not_allowed'],
    [
      'USDC sent anywhere but our contract',
      { args: { receiver_id: 'evil.testnet', amount: '1', msg: '' } },
      'receiver_not_allowed',
    ],
    [
      'a plain USDC transfer, not to a cash-out address this api quoted (intents.test.ts)',
      { method: 'ft_transfer', args: { receiver_id: CONTRACT, amount: '1' } },
      'receiver_not_allowed',
    ],
    ['more than 1 yocto attached', { deposit: 2n }, 'deposit_not_allowed'],
    ['no yocto on ft_transfer_call', { deposit: 0n }, 'deposit_not_allowed'],
    [
      'a deposit on claim_margin',
      { receiver: CONTRACT, method: 'claim_margin', args: {}, deposit: 1n },
      'deposit_not_allowed',
    ],
    ['another contract method', { receiver: CONTRACT, method: 'settle', args: {}, deposit: 0n }, 'method_not_allowed'],
    ['too much gas', { gas: 300n * TGAS }, 'gas_too_high'],
    ['a NEAR transfer', { actions: [actions.transfer(1n)] }, 'one_call_only'],
    [
      'two calls',
      {
        actions: [
          actions.functionCall('ft_transfer_call', { receiver_id: CONTRACT, amount: '1', msg: '' }, 30n * TGAS, 1n),
          actions.functionCall('ft_transfer_call', { receiver_id: CONTRACT, amount: '1', msg: '' }, 30n * TGAS, 1n),
        ],
      },
      'one_call_only',
    ],
    ['a key that is not the sender’s', { key: KeyPair.fromRandom('ed25519') }, 'wrong_key'],
  ]
  it.each(cases)('refuses %s, and never reaches the relayer', async (_, opts, code) => {
    const { relay, calls } = setup()
    expect(await refusal(await relay(wire(opts)))).toEqual({ status: 403, body: { error: code } })
    expect(calls).toEqual([])
  })

  it('refuses a signature that does not match the delegate', async () => {
    const { relay, calls } = setup()
    const bytes = Buffer.from(wire({}), 'base64')
    bytes[bytes.length - 1]! ^= 0xff // flip a bit of the signature
    expect(await refusal(await relay(bytes.toString('base64')))).toEqual({
      status: 403,
      body: { error: 'bad_signature' },
    })
    expect(calls).toEqual([])
  })

  it('refuses something that is not a delegate', async () => {
    const { relay } = setup()
    expect(await refusal(await relay(Buffer.from('hello').toString('base64')))).toEqual({
      status: 400,
      body: { error: 'bad_delegate' },
    })
  })

  it('answers 422 and keeps the record when the relayed call fails on chain', async () => {
    const { relay, failRelay, db } = setup()
    failRelay()
    const res = await relay(wire({}))
    expect(res.status).toBe(422)
    expect(all(db, 'SELECT ok, error FROM relays')).toEqual([{ ok: 0, error: 'ActionError' }])
  })

  it('needs sign-in, a NEAR account, an unbanned player and a relayer', async () => {
    expect((await setup().relay(wire({}), '')).status).toBe(401)
    const noNear = setup({ alice: { email: 'alice@test.io', nearAccount: '' } })
    expect(await refusal(await noNear.relay(wire({})))).toEqual({ status: 409, body: { error: 'no_near_account' } })
    const banned = setup()
    await banned.call('GET', '/api/me', 'tok-alice')
    banned.ban('alice')
    expect((await banned.relay(wire({}))).status).toBe(403)
    const off = testApp({}, fakeIdentity({ alice: { email: 'a@test.io', nearAccount: aliceAccount } }))
    expect(await refusal(await off.call('POST', '/api/relay', 'tok-alice', { signedDelegate: wire({}) }))).toEqual({
      status: 503,
      body: { error: 'relayer_off' },
    })
  })

  it('allows 20 relays a minute per player', async () => {
    const { relay } = setup()
    const payment = wire({})
    for (let i = 0; i < 20; i++) expect((await relay(payment)).status).toBe(200)
    expect(await refusal(await relay(payment))).toEqual({ status: 429, body: { error: 'too_many' } })
  })
})

describe('POST /api/onboard', () => {
  it('creates the account and registers USDC once, then does nothing', async () => {
    const { call, calls } = setup()
    const first = await call('POST', '/api/onboard', 'tok-alice')
    expect(await first.json()).toEqual({
      nearAccount: aliceAccount,
      createdTx: 'tx-create',
      registeredTx: 'tx-register',
    })
    const again = await call('POST', '/api/onboard', 'tok-alice')
    expect(await again.json()).toEqual({ nearAccount: aliceAccount, createdTx: null, registeredTx: null })
    expect(calls).toEqual([`create:${aliceAccount}`, `register:${aliceAccount}`])
  })

  it('needs a NEAR account and is rate-limited', async () => {
    const noNear = setup({ alice: { email: 'alice@test.io', nearAccount: '' } })
    expect((await noNear.call('POST', '/api/onboard', 'tok-alice')).status).toBe(409)
    const { call } = setup()
    for (let i = 0; i < 3; i++) expect((await call('POST', '/api/onboard', 'tok-alice')).status).toBe(200)
    expect((await call('POST', '/api/onboard', 'tok-alice')).status).toBe(429)
  })
})

describe('GET /api/parties/:id/mine', () => {
  it('lists a drink once the relay paid it, and not one that failed on chain', async () => {
    const fake = fakeRelayer()
    const env = { QUOTE_KEY: KeyPair.fromRandom('ed25519').toString() }
    const t = testApp(
      env,
      fakeIdentity({ alice: { email: 'alice@test.io', nearAccount: aliceAccount } }),
      fakeQuotes,
      fake.relayer,
    )
    const party = (await (await t.call('POST', '/api/parties', 'tok-host', { title: 'Friday Night' })).json()) as {
      id: number
    }
    const buy = async (qty: number) => {
      const q = (await (
        await t.call('POST', `/api/parties/${party.id}/quote`, 'tok-alice', { token: 'tsla', qty })
      ).json()) as { payment: { args: object } }
      return t.call('POST', '/api/relay', 'tok-alice', { signedDelegate: wire({ args: q.payment.args }) })
    }
    expect((await buy(3)).status).toBe(200)
    fake.failRelay()
    expect((await buy(1)).status).toBe(422)
    const mine = async (token: string) =>
      (await (await t.call('GET', `/api/parties/${party.id}/mine`, token)).json()) as { drinks: object[] }
    expect((await mine('tok-alice')).drinks).toEqual([
      { token: 'tsla', ticker: 'TSLA', qty: 3, total: 3 * 620_000, hash: 'tx-ok', at: expect.any(Number) },
    ])
    expect((await mine('tok-bob')).drinks).toEqual([]) // only your own
  })
})

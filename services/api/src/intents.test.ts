import { createHash } from 'node:crypto'
import {
  actions,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  KeyPair,
  keyToImplicitAddress,
} from 'near-api-js'
import { describe, expect, it, vi } from 'vitest'
import { USDC_BY_NETWORK } from './config.ts'
import { all, run } from './db.ts'
import {
  CASH_OUT_GAS,
  type OneClick,
  type OneClickQuote,
  type OneClickToken,
  type QuoteRequest,
  toUnits,
} from './intents.ts'
import { checkDelegate } from './relay.ts'
import { fakeIdentity, fakeQuotes, fakeRelayer, testApp } from './testing.ts'

const USDC_MAIN = USDC_BY_NETWORK.mainnet
const USDC_ASSET = `nep141:${USDC_MAIN}`
const MAINNET = { NEAR_NETWORK: 'mainnet', CONTRACT_ID: 'nyxeron.near' }
const TGAS = 1_000_000_000_000n

// Test data only: the real ids come from /v0/tokens at run time.
const TOKENS: OneClickToken[] = [
  { assetId: USDC_ASSET, decimals: 6, blockchain: 'near', symbol: 'USDC', price: 1 },
  { assetId: 'nep141:base-usdc.test', decimals: 6, blockchain: 'base', symbol: 'USDC', price: 1 },
  { assetId: 'nep141:eth.test', decimals: 18, blockchain: 'eth', symbol: 'ETH', price: 2500 },
]

// 1Click in memory: records every quote; a committed (wet) quote gets a fresh 64-hex deposit address.
function fakeOneClick(opts: { failQuote?: string } = {}) {
  const quotes: QuoteRequest[] = []
  const statuses = new Map<string, string>()
  const submitted: { txHash: string; depositAddress: string; nearSenderAccount: string }[] = []
  let statusCalls = 0
  const oneclick: OneClick = {
    async tokens() {
      return TOKENS
    },
    async quote(req) {
      quotes.push(req)
      if (opts.failQuote) throw new Error(opts.failQuote)
      const n = quotes.length
      const depositAddress = req.dry ? undefined : createHash('sha256').update(`dep-${n}`).digest('hex')
      return {
        correlationId: `corr-${n}`,
        quote: {
          ...(depositAddress ? { depositAddress } : {}),
          amountIn: req.amount,
          amountInFormatted: '10.00',
          amountOut: String(BigInt(req.amount) - 4900n),
          amountOutFormatted: '9.99',
          minAmountOut: '9895723',
          deadline: req.deadline,
          timeEstimate: 22,
        },
      } satisfies OneClickQuote
    },
    async status(addr) {
      statusCalls++
      return { status: statuses.get(addr) ?? 'PENDING_DEPOSIT' }
    },
    async submitDeposit(d) {
      submitted.push(d)
    },
  }
  return { oneclick, quotes, statuses, submitted, statusCalls: () => statusCalls }
}

const alice = KeyPair.fromRandom('ed25519')
const aliceAccount = keyToImplicitAddress(alice.getPublicKey())
const bob = KeyPair.fromRandom('ed25519')
const bobAccount = keyToImplicitAddress(bob.getPublicKey())
const profiles = {
  alice: { email: 'alice@test.io', nearAccount: aliceAccount },
  bob: { email: 'bob@test.io', nearAccount: bobAccount },
}

function setup(env: Record<string, string> = {}, fc = fakeOneClick()) {
  const relayer = fakeRelayer()
  const t = testApp(env, fakeIdentity(profiles), fakeQuotes, relayer.relayer, fc.oneclick)
  return { ...t, ...fc, relayer }
}
const json = async (res: Response) => (await res.json()) as Record<string, unknown>

// The player's signed USDC transfer, encoded the way the browser sends it to /api/relay.
function cashOutDelegate(opts: { to: string; amount: string; deposit?: bigint; key?: KeyPair; usdc?: string }) {
  const key = opts.key ?? alice
  const delegateAction = buildDelegateAction({
    senderId: keyToImplicitAddress(key.getPublicKey()),
    receiverId: opts.usdc ?? USDC_MAIN,
    nonce: 1n,
    maxBlockHeight: 1_000n,
    publicKey: key.getPublicKey(),
    actions: [
      actions.functionCall(
        'ft_transfer',
        { receiver_id: opts.to, amount: opts.amount },
        50n * TGAS,
        opts.deposit ?? 1n,
      ),
    ],
  })
  const hash = createHash('sha256').update(encodeDelegateAction(delegateAction)).digest()
  const signature = { ed25519Signature: { data: key.sign(hash).signature } }
  return Buffer.from(encodeSignedDelegate({ delegateAction, signature } as never)).toString('base64')
}

describe('toUnits', () => {
  it('turns a decimal amount into the smallest unit, refusing anything that is not a positive amount', () => {
    expect(toUnits('10', 6)).toBe(10_000_000n)
    expect(toUnits('0.000001', 6)).toBe(1n)
    expect(toUnits('1.5', 18)).toBe(1_500_000_000_000_000_000n)
    for (const bad of ['0', '0.0', '-1', 'abc', '1e6', '1.0000001', '', ' . '])
      expect(toUnits(bad, 6), bad).toBeUndefined()
  })
})

describe('Add money', () => {
  it('on testnet: a dry run against mainnet ids, into the player’s own account, nothing stored or to send', async () => {
    const t = setup()
    const res = await t.call('POST', '/api/me/add-money', 'tok-alice', {
      from: { blockchain: 'base', symbol: 'usdc' },
      amount: '10',
      refundTo: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    })
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ dry: true, amountIn: '10000000', amountOutFormatted: '9.99' })
    expect(t.quotes[0]).toMatchObject({
      dry: true,
      swapType: 'EXACT_INPUT',
      originAsset: 'nep141:base-usdc.test',
      destinationAsset: USDC_ASSET, // mainnet USDC even on testnet: 1Click has no testnet
      amount: '10000000',
      recipient: aliceAccount, // non-custodial: straight to the player
      recipientType: 'DESTINATION_CHAIN',
      refundTo: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      refundType: 'ORIGIN_CHAIN',
      depositType: 'ORIGIN_CHAIN',
      referral: 'nyxeron',
    })
    expect(all(t.db, 'SELECT * FROM intents')).toEqual([])
  })

  it('on mainnet: stores the quote with its deposit address, and tracks 1Click’s status (at most every 10 s)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t = setup(MAINNET)
      const res = await t.call('POST', '/api/me/add-money', 'tok-alice', {
        from: { blockchain: 'eth', symbol: 'ETH' },
        amount: '0.01',
        refundTo: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      })
      expect(res.status).toBe(201)
      const body = (await json(res)) as { intent: { id: string; depositAddress: string; status: string } }
      expect(t.quotes[0]).toMatchObject({ dry: false, amount: '10000000000000000', recipient: aliceAccount })
      expect(body.intent).toMatchObject({ id: 'corr-1', kind: 'add_money', status: 'PENDING_DEPOSIT' })
      expect(body.intent.depositAddress).toMatch(/^[0-9a-f]{64}$/)

      const list = async () =>
        ((await json(await t.call('GET', '/api/me/intents', 'tok-alice'))) as { intents: { status: string }[] }).intents
      t.statuses.set(body.intent.depositAddress, 'SUCCESS')
      expect((await list())[0]!.status).toBe('PENDING_DEPOSIT') // checked just now, at the quote
      vi.setSystemTime(Date.now() + 11_000)
      expect((await list())[0]!.status).toBe('SUCCESS')
      const calls = t.statusCalls()
      vi.setSystemTime(Date.now() + 60_000)
      expect((await list())[0]!.status).toBe('SUCCESS')
      expect(t.statusCalls()).toBe(calls) // final: never asked again

      expect((await t.call('GET', `/api/me/intents/${body.intent.id}`, 'tok-bob')).status).toBe(404) // not bob's
      expect(await json(await t.call('GET', `/api/me/intents/${body.intent.id}`, 'tok-alice'))).toMatchObject({
        status: 'SUCCESS',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    [
      'an asset 1Click does not list',
      { from: { blockchain: 'base', symbol: 'DOGE' }, amount: '1' },
      400,
      'unknown_asset',
    ],
    ['a zero amount', { from: { blockchain: 'base', symbol: 'USDC' }, amount: '0' }, 400, 'bad_amount'],
    [
      'more decimals than the token has',
      { from: { blockchain: 'base', symbol: 'USDC' }, amount: '1.0000001' },
      400,
      'bad_amount',
    ],
    ['more than $1,000', { from: { blockchain: 'eth', symbol: 'ETH' }, amount: '1' }, 400, 'bad_amount'],
  ])('refuses %s', async (_, body, status, error) => {
    const t = setup()
    const res = await t.call('POST', '/api/me/add-money', 'tok-alice', { refundTo: '0xabc', ...body })
    expect(res.status).toBe(status)
    expect(await json(res)).toEqual({ error })
    expect(t.quotes).toEqual([])
  })

  it('says why when 1Click is off, refuses the quote, or the player has no NEAR account yet', async () => {
    const body = { from: { blockchain: 'base', symbol: 'USDC' }, amount: '1', refundTo: '0xabc' }
    const off = testApp({}, fakeIdentity(profiles), fakeQuotes)
    expect(await json(await off.call('POST', '/api/me/add-money', 'tok-alice', body))).toEqual({ error: 'intents_off' })
    const failing = setup({}, fakeOneClick({ failQuote: 'recipient is not valid' }))
    const res = await failing.call('POST', '/api/me/add-money', 'tok-alice', body)
    expect(res.status).toBe(502)
    expect(await json(res)).toEqual({ error: 'quote_failed' })
    const noNear = testApp(
      {},
      fakeIdentity({ alice: { email: 'a@test.io', nearAccount: '' } }),
      fakeQuotes,
      undefined,
      fakeOneClick().oneclick,
    )
    expect(await json(await noNear.call('POST', '/api/me/add-money', 'tok-alice', body))).toEqual({
      error: 'no_near_account',
    })
  })
})

describe('Cash out', () => {
  const to = { blockchain: 'base', symbol: 'USDC', address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' }

  it('on mainnet: hands back the exact USDC transfer to sign, to 1Click’s deposit address, refunds to the player', async () => {
    const t = setup(MAINNET)
    const res = await t.call('POST', '/api/me/cash-out', 'tok-alice', { to, amount: '5.25' })
    expect(res.status).toBe(201)
    const body = (await json(res)) as { intent: { depositAddress: string }; payment: unknown }
    expect(t.quotes[0]).toMatchObject({
      dry: false,
      originAsset: USDC_ASSET,
      destinationAsset: 'nep141:base-usdc.test',
      amount: '5250000',
      recipient: to.address,
      refundTo: aliceAccount,
    })
    expect(body.payment).toEqual({
      receiverId: USDC_MAIN,
      method: 'ft_transfer',
      args: { receiver_id: body.intent.depositAddress, amount: '5250000' },
      deposit: '1',
      gas: CASH_OUT_GAS,
    })
  })

  it('on testnet: a dry run with nothing to sign', async () => {
    const t = setup()
    const body = await json(await t.call('POST', '/api/me/cash-out', 'tok-alice', { to, amount: '5' }))
    expect(body).toMatchObject({ dry: true, amountIn: '5000000' })
    expect(body.payment).toBeUndefined()
    expect(t.quotes[0]).toMatchObject({ dry: true, originAsset: USDC_ASSET, refundTo: aliceAccount })
  })

  it.each([
    ['below $1', '0.99'],
    ['above $1,000', '1000.01'],
    ['more than 6 decimals', '1.0000001'],
  ])('refuses an amount %s', async (_, amount) => {
    const t = setup(MAINNET)
    expect(await json(await t.call('POST', '/api/me/cash-out', 'tok-alice', { to, amount }))).toEqual({
      error: 'bad_amount',
    })
  })
})

describe('the relay and cash-outs (money rule)', () => {
  const to = { blockchain: 'base', symbol: 'USDC', address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' }
  async function quoted() {
    const t = setup(MAINNET)
    const body = (await json(await t.call('POST', '/api/me/cash-out', 'tok-alice', { to, amount: '5' }))) as {
      intent: { depositAddress: string }
    }
    const relay = (signedDelegate: string, token = 'tok-alice') =>
      t.call('POST', '/api/relay', token, { signedDelegate })
    return { ...t, dep: body.intent.depositAddress, relay }
  }

  it('relays the quoted transfer once, records it, and tells 1Click about the deposit', async () => {
    const t = await quoted()
    const res = await t.relay(cashOutDelegate({ to: t.dep, amount: '5000000' }))
    expect(res.status).toBe(200)
    expect(t.relayer.calls).toEqual([`relay:${USDC_MAIN}:ft_transfer`])
    expect(all(t.db, 'SELECT deposit_tx FROM intents')).toEqual([{ deposit_tx: 'tx-ok' }])
    expect(t.submitted).toEqual([{ txHash: 'tx-ok', depositAddress: t.dep, nearSenderAccount: aliceAccount }])
    // Paying the same deposit address twice is refused.
    expect(await json(await t.relay(cashOutDelegate({ to: t.dep, amount: '5000000' })))).toEqual({
      error: 'cash_out_paid',
    })
  })

  it('two taps at once: the deposit goes out once, the second is refused', async () => {
    const t = await quoted()
    const d = cashOutDelegate({ to: t.dep, amount: '5000000' })
    const [a, b] = await Promise.all([t.relay(d), t.relay(d)])
    expect([a.status, b.status].sort()).toEqual([200, 403])
    expect(t.relayer.calls).toEqual([`relay:${USDC_MAIN}:ft_transfer`])
    expect(all(t.db, 'SELECT deposit_tx FROM intents')).toEqual([{ deposit_tx: 'tx-ok' }])
  })

  it('a deposit that failed on chain moved no USDC: the quote can be paid again', async () => {
    const t = await quoted()
    t.relayer.failRelay()
    expect((await t.relay(cashOutDelegate({ to: t.dep, amount: '5000000' }))).status).toBe(422)
    expect(all(t.db, 'SELECT deposit_tx FROM intents')).toEqual([{ deposit_tx: '' }])
    expect((await t.relay(cashOutDelegate({ to: t.dep, amount: '5000000' }))).status).toBe(200)
  })

  it.each([
    [
      'an address the api never quoted',
      (dep: string) => ({ to: `${dep.slice(0, -1)}0`, amount: '5000000' }),
      'receiver_not_allowed',
    ],
    ['another amount than quoted', (dep: string) => ({ to: dep, amount: '5000001' }), 'amount_not_allowed'],
    [
      'a deposit other than 1 yocto',
      (dep: string) => ({ to: dep, amount: '5000000', deposit: 2n }),
      'deposit_not_allowed',
    ],
  ])('refuses %s', async (_, make, error) => {
    const t = await quoted()
    const res = await t.relay(cashOutDelegate(make(t.dep)))
    expect(res.status).toBe(403)
    expect(await json(res)).toEqual({ error })
    expect(t.relayer.calls).toEqual([])
  })

  it('refuses another player paying into this player’s deposit address, and an expired quote', async () => {
    const t = await quoted()
    const bobs = await t.relay(cashOutDelegate({ to: t.dep, amount: '5000000', key: bob }), 'tok-bob')
    expect(await json(bobs)).toEqual({ error: 'receiver_not_allowed' })
    run(t.db, 'UPDATE intents SET deadline = 0')
    expect(await json(await t.relay(cashOutDelegate({ to: t.dep, amount: '5000000' })))).toEqual({
      error: 'cash_out_expired',
    })
    expect(t.relayer.calls).toEqual([])
  })

  it('without a cash-out lookup, a USDC ft_transfer is never allowed', () => {
    const d = {
      delegateAction: {
        senderId: 'p.near',
        receiverId: USDC_MAIN,
        nonce: 1n,
        maxBlockHeight: 1n,
        publicKey: { ed25519Key: { data: [] } },
        actions: [
          {
            functionCall: {
              methodName: 'ft_transfer',
              args: Buffer.from(JSON.stringify({ receiver_id: 'x', amount: '1' })),
              gas: 1n,
              deposit: 1n,
            },
          },
        ],
      },
      signature: {},
    }
    expect(checkDelegate(d, { sender: 'p.near', contractId: 'nyxeron.near', usdcId: USDC_MAIN })).toBe(
      'receiver_not_allowed',
    )
  })
})

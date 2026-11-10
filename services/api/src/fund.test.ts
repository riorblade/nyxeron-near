import { createHash } from 'node:crypto'
import { Account, JsonRpcProvider, KeyPair, type KeyPairString, type SignedTransaction } from 'near-api-js'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { USDG } from './chainsig.ts'
import { USDC_BY_NETWORK } from './config.ts'
import { all, one, openDb, run } from './db.ts'
import { dexEthPrice, FUND_LIMITS, HOOD_WETH, nearTreasury, type Treasury, warehouseFunder } from './fund.ts'
import type { OneClick, OneClickToken, QuoteRequest } from './intents.ts'

const USDC = USDC_BY_NETWORK.mainnet
const USDC_ASSET = `nep141:${USDC}`
const WAREHOUSE: Address = '0x975B19e0ae6A0fA87D51Fa618fC12724c137b33C'
const TREASURY = 'treasury.near'
const NOW = Date.UTC(2026, 10, 7, 12)
const E18 = 10n ** 18n

// Test data shaped like 1Click's /v0/tokens on 2026-11-07 (the real ids are read at run time).
const USDG_ASSET = `nep141:hood-${USDG}.omft.near`
const ETH_ASSET = 'nep141:hood.omft.near'
type Listed = OneClickToken & { contractAddress?: string }
const LISTED: Listed[] = [
  { assetId: USDC_ASSET, decimals: 6, blockchain: 'near', symbol: 'USDC', price: 1, contractAddress: USDC },
  { assetId: USDG_ASSET, decimals: 6, blockchain: 'hood', symbol: 'USDG', price: 1, contractAddress: USDG },
  { assetId: ETH_ASSET, decimals: 18, blockchain: 'hood', symbol: 'ETH', price: 2500 },
  // Another hood token called USDG at another address: never the one we fund with.
  {
    assetId: 'nep141:hood-0x1111111111111111111111111111111111111111.omft.near',
    decimals: 6,
    blockchain: 'hood',
    symbol: 'USDG',
    price: 1,
    contractAddress: '0x1111111111111111111111111111111111111111',
  },
]

// 1Click: a quote loses `lossBps` of the input; `tamper` edits the answer, `status` is what /status says per address.
function fakeOneClick(opts: { lossBps?: bigint; tamper?: (a: Answer) => void; list?: Listed[] } = {}) {
  const quotes: QuoteRequest[] = []
  const submitted: string[] = []
  const status = new Map<string, string>()
  let statusCalls = 0
  const oneclick: OneClick = {
    async tokens() {
      return opts.list ?? LISTED
    },
    async quote(req) {
      quotes.push(req)
      const depositAddress = createHash('sha256').update(`dep-${quotes.length}`).digest('hex')
      const out = (BigInt(req.amount) * (10_000n - (opts.lossBps ?? 150n))) / 10_000n // micro-USD worth
      const minOut = req.destinationAsset === ETH_ASSET ? (out * 10n ** 12n) / 2500n : out
      const answer: Answer = {
        correlationId: `corr-${quotes.length}`,
        quote: {
          depositAddress,
          depositMemo: null,
          amountIn: req.amount,
          minAmountOut: minOut.toString(),
          deadline: new Date(NOW + 3 * 86_400_000).toISOString(),
        },
        quoteRequest: { ...req },
      }
      opts.tamper?.(answer)
      return answer as never
    },
    async status(addr) {
      statusCalls++
      return { status: status.get(addr) ?? 'PENDING_DEPOSIT' }
    },
    async submitDeposit(d) {
      submitted.push(d.txHash)
    },
  }
  return { oneclick, quotes, submitted, status, statusCalls: () => statusCalls }
}
type Answer = {
  correlationId: string
  quote: {
    depositAddress: string
    depositMemo: string | null
    amountIn: string
    minAmountOut: string
    deadline: string
  }
  quoteRequest: Record<string, unknown>
}

// The treasury: its USDC, the accounts USDC knows, and every deposit it sent. `fail` makes the next one fail on chain,
// `throws` lose its answer.
function fakeTreasury(usdc = 1_000_000_000n) {
  const state = { usdc, registered: new Set<string>(), deposits: [] as string[], fail: false, throws: false }
  const treasury: Treasury = {
    accountId: TREASURY,
    async usdcBalance() {
      return state.usdc
    },
    async isRegistered(id) {
      return state.registered.has(id)
    },
    async deposit(to, amount, register) {
      if (state.throws) throw new Error('timeout')
      state.deposits.push(`${register ? 'register+' : ''}${to}:${amount}`)
      if (state.fail) {
        state.fail = false
        return { hash: 'tx-failed', ok: false, error: 'not registered' }
      }
      state.usdc -= amount
      return { hash: `tx-${state.deposits.length}`, ok: true }
    },
  }
  return { treasury, state }
}

function setup(o: Parameters<typeof fakeOneClick>[0] & { usdc?: bigint; ethPrice?: number } = {}) {
  const db = openDb(':memory:')
  let t = NOW
  const fc = fakeOneClick(o)
  const tr = fakeTreasury(o.usdc)
  // The warehouse starts full; tests drain what they need.
  const held = { usdg: 100_000_000n, eth: E18 }
  const logs: string[] = []
  const funder = warehouseFunder({
    db,
    oneclick: fc.oneclick,
    treasury: tr.treasury,
    chain: { usdgBalance: async () => held.usdg, ethBalance: async () => held.eth },
    warehouse: async () => WAREHOUSE,
    // The second price source; 1Click's own (LISTED) is not used for the 97 % check.
    ethPrice: async () => o.ethPrice ?? 2500,
    usdcId: USDC,
    now: () => t,
    log: (m) => logs.push(m),
  })
  const rows = () =>
    all<{ id: string; asset: string; status: string; amount_in: number; error: string }>(
      db,
      'SELECT id, asset, status, amount_in, error FROM warehouse_funding ORDER BY created_at, id',
    )
  return { db, funder, ...fc, ...tr, held, logs, rows, later: (ms: number) => (t += ms) }
}

describe('keeping the warehouse funded', () => {
  it('does nothing while the warehouse holds enough of both', async () => {
    const t = setup()
    await t.funder.tick()
    expect(t.quotes).toEqual([])
  })

  it('tops up USDG: a 1Click quote from the treasury to the warehouse, sent with the registration, then followed', async () => {
    const t = setup()
    t.held.usdg = FUND_LIMITS.usdgFloor - 1n
    await t.funder.tick()
    expect(t.quotes).toHaveLength(1)
    expect(t.quotes[0]).toMatchObject({
      dry: false,
      originAsset: USDC_ASSET,
      destinationAsset: USDG_ASSET,
      amount: '100000000',
      recipient: WAREHOUSE,
      refundTo: TREASURY,
      recipientType: 'DESTINATION_CHAIN',
      refundType: 'ORIGIN_CHAIN',
    })
    const dep = createHash('sha256').update('dep-1').digest('hex')
    // 1Click's deposit address is new to USDC: registered in the same transaction (issue #65).
    expect(t.state.deposits).toEqual([`register+${dep}:100000000`])
    expect(t.submitted).toEqual(['tx-1'])
    expect(t.rows()).toMatchObject([{ asset: 'usdg', status: 'sent', amount_in: 100_000_000 }])

    // In flight: no second deposit while 1Click works, however low the balance still reads.
    t.later(10_000)
    await t.funder.tick()
    expect(t.quotes).toHaveLength(1)

    t.status.set(dep, 'SUCCESS')
    t.later(10_000)
    t.held.usdg = FUND_LIMITS.usdgFloor - 1n + 98_500_000n // what it held + the quote's minimum out
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ status: 'done' }])
    expect(t.quotes).toHaveLength(1)
  })

  it('does not register an address USDC already knows', async () => {
    const t = setup()
    t.held.usdg = 0n
    t.state.registered.add(createHash('sha256').update('dep-1').digest('hex'))
    await t.funder.tick()
    expect(t.state.deposits[0]).not.toMatch(/^register\+/)
  })

  it('tops up gas first, one deposit per tick, then USDG', async () => {
    const t = setup()
    t.held.usdg = 0n
    t.held.eth = FUND_LIMITS.ethFloor - 1n
    await t.funder.tick()
    expect(t.quotes.map((q) => [q.destinationAsset, q.amount])).toEqual([[ETH_ASSET, '5000000']])
    await t.funder.tick()
    expect(t.quotes.map((q) => q.destinationAsset)).toEqual([ETH_ASSET, USDG_ASSET])
  })

  it('sends what the treasury has, and nothing below the minimum deposit', async () => {
    const t = setup({ usdc: 30_000_000n })
    t.held.usdg = 0n
    await t.funder.tick()
    expect(t.quotes[0]!.amount).toBe('30000000')

    const poor = setup({ usdc: FUND_LIMITS.minRefill - 1n })
    poor.held.usdg = 0n
    await poor.funder.tick()
    expect(poor.quotes).toEqual([])
    expect(poor.logs.join()).toContain('treasury_low')
  })

  it('funds with the USDG at our pinned address only, and stops when 1Click no longer lists it', async () => {
    const t = setup({ list: LISTED.filter((x) => x.assetId !== USDG_ASSET) })
    t.held.usdg = 0n
    await t.funder.tick()
    expect(t.quotes).toEqual([])
    expect(t.logs.join()).toContain('asset_not_listed')
  })
})

describe('checking 1Click’s quote before any USDC moves', () => {
  it.each([
    ['another recipient', (a: Answer) => (a.quoteRequest.recipient = `0x${'22'.repeat(20)}`), 'wrong_recipient'],
    ['another asset out', (a: Answer) => (a.quoteRequest.destinationAsset = ETH_ASSET), 'wrong_asset'],
    ['another asset in', (a: Answer) => (a.quoteRequest.originAsset = 'nep141:usdt.tether-token.near'), 'wrong_asset'],
    ['refunds elsewhere', (a: Answer) => (a.quoteRequest.refundTo = 'someone.near'), 'wrong_refund'],
    ['another amount', (a: Answer) => (a.quote.amountIn = '100000001'), 'wrong_amount'],
    ['a memo we would not send', (a: Answer) => (a.quote.depositMemo = '42'), 'memo_not_supported'],
    ['a named deposit account', (a: Answer) => (a.quote.depositAddress = 'evil.near'), 'bad_quote'],
    ['an expired deadline', (a: Answer) => (a.quote.deadline = new Date(NOW).toISOString()), 'bad_quote'],
    ['a dry run', (a: Answer) => (a.quoteRequest.dry = true), 'wrong_kind'],
    ['an exact-output swap', (a: Answer) => (a.quoteRequest.swapType = 'EXACT_OUTPUT'), 'wrong_kind'],
    ['a deposit inside intents', (a: Answer) => (a.quoteRequest.depositType = 'INTENTS'), 'wrong_kind'],
    ['delivery into intents.near', (a: Answer) => (a.quoteRequest.recipientType = 'INTENTS'), 'wrong_recipient_type'],
    ['a refund into intents.near', (a: Answer) => (a.quoteRequest.refundType = 'INTENTS'), 'wrong_refund'],
    ['an answer without the echoed request types', (a: Answer) => delete a.quoteRequest.recipientType, 'bad_quote'],
  ])('refuses %s', async (_, tamper, code) => {
    const t = setup({ tamper })
    t.held.usdg = 0n
    await t.funder.tick()
    expect(t.state.deposits).toEqual([])
    expect(t.rows()).toEqual([])
    expect(t.logs.join()).toContain(code)
  })

  it('refuses a quote losing more than 3 %, for USDG and for ETH, and takes one just under', async () => {
    for (const asset of ['usdg', 'eth'] as const) {
      const costly = setup({ lossBps: 301n })
      costly.held[asset] = 0n
      await costly.funder.tick()
      expect(costly.state.deposits, asset).toEqual([])
      expect(costly.logs.join()).toContain('too_costly')

      const fine = setup({ lossBps: 300n })
      fine.held[asset] = 0n
      await fine.funder.tick()
      expect(fine.state.deposits, asset).toHaveLength(1)
    }
  })
})

describe('prices and delivery checked outside 1Click', () => {
  it("prices ETH with the second source, not 1Click's own price", async () => {
    // 1Click lists ETH at $2500 and quotes by it, but the market is at $2000: what arrives is worth 20 % less
    const t = setup({ ethPrice: 2000 })
    t.held.eth = 0n
    await t.funder.tick()
    expect(t.state.deposits).toEqual([])
    expect(t.logs.join()).toContain('too_costly')
  })

  it('stops when there is no second price for ETH', async () => {
    const t = setup({ ethPrice: Number.NaN })
    t.held.eth = 0n
    await t.funder.tick()
    expect(t.state.deposits).toEqual([])
    expect(t.logs.join()).toContain('no_price')
  })

  it('USDG is $1, whatever 1Click lists it at', async () => {
    const list = LISTED.map((x) => (x.assetId === USDG_ASSET ? { ...x, price: 1.2 } : x))
    const t = setup({ list, lossBps: 400n })
    t.held.usdg = 0n
    await t.funder.tick()
    expect(t.state.deposits).toEqual([])
    expect(t.logs.join()).toContain('too_costly')
  })

  it("believes 1Click's SUCCESS only once the warehouse's balance shows the delivery", async () => {
    const t = setup()
    t.held.usdg = 10_000_000n
    await t.funder.tick()
    const dep = createHash('sha256').update('dep-1').digest('hex')
    t.status.set(dep, 'SUCCESS')
    t.later(10_000)
    await t.funder.tick() // nothing arrived yet
    expect(t.rows()).toMatchObject([{ status: 'sent' }])
    expect(t.logs.join()).toContain("balance doesn't show it yet")
    t.later(10_000)
    t.held.usdg = 10_000_000n + 98_500_000n
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ status: 'done' }])
  })

  it('counts what the swaps spent meanwhile', async () => {
    const t = setup()
    t.held.usdg = 10_000_000n
    await t.funder.tick()
    t.later(1000)
    run(
      t.db,
      `INSERT INTO warehouse_swaps (id, token, units, usdg_in, need_ui, need_raw, nonce, raw_tx, tx_hash, status, at)
       VALUES ('p1:tsla', 'tsla', 10, 40000000, '0', '0', 0, '0x', '0x', 'done', ?)`,
      NOW + 1000,
    )
    t.status.set(createHash('sha256').update('dep-1').digest('hex'), 'SUCCESS')
    t.later(10_000)
    t.held.usdg = 10_000_000n + 98_500_000n - 40_000_000n
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ status: 'done' }])
  })

  it('a swap still in flight, stuck or reverted is not counted as spent: SUCCESS with nothing delivered is not done', async () => {
    const t = setup()
    t.held.usdg = 10_000_000n
    await t.funder.tick()
    for (const [id, status] of [
      ['a', 'sent'],
      ['b', 'stuck'],
      ['c', 'failed'],
    ] as const)
      run(
        t.db,
        `INSERT INTO warehouse_swaps (id, token, units, usdg_in, need_ui, need_raw, nonce, raw_tx, tx_hash, status, at)
         VALUES (?, 'tsla', 1, 50000000, '0', '0', 0, '0x', '0x', ?, ?)`,
        id,
        status,
        NOW + 1000,
      )
    t.status.set(createHash('sha256').update('dep-1').digest('hex'), 'SUCCESS')
    t.later(10_000)
    await t.funder.tick() // the balance is unchanged: nothing arrived
    expect(t.rows()).toMatchObject([{ status: 'sent' }])
  })

  it("counts the gas the finished swaps' receipts show, not a cap: busy swaps can't cover an ETH delivery that never came", async () => {
    const t = setup()
    t.held.eth = 190_000_000_000_000n
    await t.funder.tick()
    const add = (id: string, gasWei: bigint) =>
      run(
        t.db,
        `INSERT INTO warehouse_swaps (id, token, units, usdg_in, need_ui, need_raw, nonce, raw_tx, tx_hash, status, gas_wei,
           at) VALUES (?, 'tsla', 1, 4000000, '0', '0', 0, '0x', '0x', 'done', ?, ?)`,
        id,
        gasWei.toString(),
        NOW + 1000,
      )
    // five swaps at 0.000024 ETH each while 1Click says SUCCESS but sent nothing (their gas cap, 2 × 0.0003 ETH a
    // swap, would have covered the whole 0.00197 ETH)
    for (let i = 0; i < 5; i++) add(`s${i}`, 24_000_000_000_000n)
    t.held.eth = 190_000_000_000_000n - 5n * 24_000_000_000_000n
    t.status.set(createHash('sha256').update('dep-1').digest('hex'), 'SUCCESS')
    t.later(10_000)
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ status: 'sent' }])
    // and once it really arrives (the quote's minimum out, 0.00197 ETH), it is done
    t.held.eth += 1_970_000_000_000_000n
    t.later(10_000)
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ status: 'done' }])
  })

  it('a SUCCESS that never shows on chain stops for a person', async () => {
    const t = setup()
    t.held.usdg = 10_000_000n
    await t.funder.tick()
    t.status.set(createHash('sha256').update('dep-1').digest('hex'), 'SUCCESS')
    t.later(3 * 86_400_000 + 10 * 60_000 + 1)
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ status: 'stuck', error: 'success_not_on_chain' }])
  })
})

describe('limits and unclear states', () => {
  it('stops at the daily cap; yesterday and deposits that failed on chain do not count', async () => {
    const t = setup()
    const add = (id: string, micro: number, at: number, status: string) =>
      run(
        t.db,
        `INSERT INTO warehouse_funding (id, asset, amount_in, min_out, deposit_address, status, deadline, checked_at,
           created_at) VALUES (?, 'usdg', ?, '0', ?, ?, 0, 0, ?)`,
        id,
        micro,
        `addr-${id}`,
        status,
        at,
      )
    add('old', 500_000_000, NOW - 86_400_000, 'done')
    add('a', 450_000_000, NOW - 1000, 'done')
    add('b', 100_000_000, NOW - 1000, 'failed')
    add('c', 60_000_000, NOW - 1000, 'refunded')
    t.held.usdg = 0n
    await t.funder.tick()
    expect(t.quotes).toEqual([]) // 510 + 100 > 600
    expect(t.logs.join()).toContain('daily_limit')
    run(t.db, "DELETE FROM warehouse_funding WHERE id = 'c'")
    await t.funder.tick()
    expect(t.state.deposits).toHaveLength(1) // 450 + 100 ≤ 600
  })

  it('a deposit that failed on chain moved nothing: the next tick tries again', async () => {
    const t = setup()
    t.held.usdg = 0n
    t.state.fail = true
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ status: 'failed' }])
    await t.funder.tick()
    expect(t.rows().map((r) => r.status)).toEqual(['failed', 'sent'])
  })

  it('stops for the day after three deposits failed on chain', async () => {
    const t = setup()
    t.held.usdg = 0n
    for (let i = 0; i < 3; i++) {
      t.state.fail = true
      await t.funder.tick()
    }
    expect(t.rows().map((r) => r.status)).toEqual(['failed', 'failed', 'failed'])
    await t.funder.tick()
    expect(t.quotes).toHaveLength(3)
    expect(t.logs.join()).toContain('too_many_failures')
    t.later(86_400_000)
    await t.funder.tick()
    expect(t.quotes).toHaveLength(4)
  })

  it('a deposit whose answer was lost stops for a person and blocks that asset only', async () => {
    const t = setup()
    t.held.usdg = 0n
    t.state.throws = true
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ asset: 'usdg', status: 'stuck', error: 'deposit_unknown' }])
    t.state.throws = false
    for (let i = 0; i < 3; i++) {
      t.later(60_000)
      await t.funder.tick()
    }
    expect(t.quotes).toHaveLength(1)
    // It still counts toward the day, and gas can still be topped up.
    expect(t.funder.spentToday()).toBe(100_000_000n)
    t.held.eth = 0n
    await t.funder.tick()
    expect(t.rows().map((r) => r.asset)).toEqual(['usdg', 'eth'])
  })

  it('the deposit is on record as quoted while the USDC is being sent', async () => {
    const t = setup()
    t.held.usdg = 0n
    const seen: unknown[] = []
    const send = t.treasury.deposit
    t.treasury.deposit = async (...a) => {
      seen.push(...all(t.db, 'SELECT status, deposit_address FROM warehouse_funding'))
      return send(...a)
    }
    await t.funder.tick()
    expect(seen).toEqual([{ status: 'quoted', deposit_address: createHash('sha256').update('dep-1').digest('hex') }])
  })

  it('a row left quoted by a crash is not sent again', async () => {
    const t = setup()
    run(
      t.db,
      `INSERT INTO warehouse_funding (id, asset, amount_in, min_out, deposit_address, status, deadline, checked_at,
         created_at) VALUES ('crash', 'usdg', 100000000, '0', 'addr', 'quoted', ?, 0, ?)`,
      NOW + 1000,
      NOW,
    )
    t.held.usdg = 0n
    await t.funder.tick()
    expect(t.rows()).toMatchObject([{ id: 'crash', status: 'stuck', error: 'deposit_unknown' }])
    expect(t.quotes).toEqual([])
  })

  it('a refund frees the asset for the next refill; a failed swap or a missed deadline stops for a person', async () => {
    const t = setup()
    t.held.usdg = 0n
    await t.funder.tick()
    const dep1 = createHash('sha256').update('dep-1').digest('hex')
    t.status.set(dep1, 'REFUNDED')
    t.later(10_000)
    await t.funder.tick()
    expect(t.rows().map((r) => r.status)).toEqual(['refunded', 'sent'])

    const dep2 = createHash('sha256').update('dep-2').digest('hex')
    t.status.set(dep2, 'FAILED')
    t.later(10_000)
    await t.funder.tick()
    expect(t.rows().map((r) => [r.status, r.error])).toEqual([
      ['refunded', ''],
      ['stuck', 'failed'],
    ])

    const late = setup()
    late.held.eth = 0n
    await late.funder.tick()
    late.later(3 * 86_400_000 + 1)
    await late.funder.tick()
    expect(late.rows()).toMatchObject([{ status: 'stuck', error: 'past_deadline' }])
  })

  it('asks 1Click for a status at most every 10 seconds', async () => {
    const t = setup()
    t.held.usdg = 0n
    await t.funder.tick()
    await t.funder.tick()
    t.later(9_999)
    await t.funder.tick()
    expect(t.statusCalls()).toBe(1) // the first follow-up (checked_at starts at 0)
    t.later(1)
    await t.funder.tick()
    expect(t.statusCalls()).toBe(2)
    expect(one(t.db, 'SELECT oneclick_status FROM warehouse_funding')).toEqual({ oneclick_status: 'PENDING_DEPOSIT' })
  })
})

// nearTreasury on near-api-js's own Account, against a fake RPC that keeps what it was sent.
describe('the treasury’s deposit transaction', () => {
  class FakeRpc extends JsonRpcProvider {
    sent: SignedTransaction[] = []
    fail = false
    refundFails = false
    noReceipt = false
    constructor() {
      super({ url: 'http://fake' })
    }
    override async viewAccessKey() {
      return { nonce: 1n, permission: 'FullAccess', block_height: 1, block_hash: '1'.repeat(32) } as never
    }
    override async viewBlock() {
      return { header: { hash: '1'.repeat(32), height: 1 } } as never
    }
    override async sendTransactionUntil(tx: SignedTransaction) {
      this.sent.push(tx)
      const failure = { Failure: { ActionError: { index: 1, kind: { FunctionCallError: { ExecutionError: 'x' } } } } }
      // Like the real deposit (testnet 2QVdMW…): receipt 1 runs our actions on USDC, receipt 2 refunds the sender.
      const actions = this.fail ? failure : { SuccessValue: '' }
      return {
        status: this.fail || this.refundFails ? failure : { SuccessValue: '' },
        transaction: { hash: 'tx-deposit' },
        transaction_outcome: {
          id: 'tx-deposit',
          block_hash: '1'.repeat(32),
          outcome: { receipt_ids: ['r-actions'] },
        },
        receipts_outcome: [
          ...(this.noReceipt ? [] : [{ id: 'r-actions', outcome: { status: actions } }]),
          { id: 'r-refund', outcome: { status: this.refundFails ? failure : { SuccessValue: '' } } },
        ],
      } as never
    }
  }
  const setupReal = () => {
    const rpc = new FakeRpc()
    const account = new Account('w.near', rpc, KeyPair.fromRandom('ed25519').toString() as KeyPairString)
    return { rpc, treasury: nearTreasury({ account, usdcId: USDC }) }
  }
  const calls = (tx: SignedTransaction) =>
    tx.transaction.actions.map((a) => {
      const f = a.functionCall!
      return [f.methodName, JSON.parse(Buffer.from(f.args).toString()), f.deposit.toString()]
    })

  it('registers and transfers in one transaction to USDC, 1 yocto on the transfer', async () => {
    const t = setupReal()
    expect(await t.treasury.deposit('ab'.repeat(32), 5_000_000n, true)).toEqual({ hash: 'tx-deposit', ok: true })
    expect(t.rpc.sent[0]!.transaction.receiverId).toBe(USDC)
    expect(calls(t.rpc.sent[0]!)).toEqual([
      ['storage_deposit', { account_id: 'ab'.repeat(32), registration_only: true }, '1250000000000000000000'],
      ['ft_transfer', { receiver_id: 'ab'.repeat(32), amount: '5000000' }, '1'],
    ])
    await t.treasury.deposit('ab'.repeat(32), 1n, false)
    expect(calls(t.rpc.sent[1]!).map(([m]) => m)).toEqual(['ft_transfer'])
  })

  it('a failure on chain comes back with its hash, not as a throw the funder must treat as unknown', async () => {
    const t = setupReal()
    t.rpc.fail = true
    expect(await t.treasury.deposit('ab'.repeat(32), 5_000_000n, true)).toMatchObject({ hash: 'tx-deposit', ok: false })
  })

  it('judges by the receipt that ran the transfer: a failed refund after it still means the USDC moved', async () => {
    const t = setupReal()
    t.rpc.refundFails = true
    expect(await t.treasury.deposit('ab'.repeat(32), 5_000_000n, true)).toEqual({ hash: 'tx-deposit', ok: true })
  })

  it('without that receipt’s outcome it throws, so the funder stops for a person', async () => {
    const t = setupReal()
    t.rpc.noReceipt = true
    await expect(t.treasury.deposit('ab'.repeat(32), 5_000_000n, true)).rejects.toThrow(/receipt/)
  })
})

describe('the second price for ETH', () => {
  const pair = (chainId: string, base: string, priceUsd: string, usd: number) => ({
    chainId,
    baseToken: { address: base },
    priceUsd,
    liquidity: { usd },
  })
  const answering = (body: unknown) =>
    dexEthPrice({ fetch: (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch })

  it("is WETH's deepest Robinhood Chain pool", async () => {
    const price = answering([
      pair('robinhood', HOOD_WETH, '2000', 200_000),
      pair('robinhood', HOOD_WETH, '2090.31', 13_620_679),
      pair('ethereum', HOOD_WETH, '9999', 99_000_000),
      pair('robinhood', `0x${'33'.repeat(20)}`, '1', 50_000_000),
    ])
    expect(await price()).toBe(2090.31)
  })

  it('refuses a price from a shallow pool, or none', async () => {
    await expect(answering([pair('robinhood', HOOD_WETH, '2090', 99_999)])()).rejects.toMatchObject({
      code: 'no_eth_price',
    })
    await expect(answering([])()).rejects.toMatchObject({ code: 'no_eth_price' })
  })
})

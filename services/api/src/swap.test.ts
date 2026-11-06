import { tokens } from '@nyxeron/game'
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
  keccak256,
  type Log,
  parseTransaction,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { KYBER_ROUTER } from './chainsig.ts'
import { type Db, one, openDb, run } from './db.ts'
import { SettlementError } from './settlement.ts'
import {
  type Built,
  type Hood,
  type Kyber,
  type Receipt,
  type Route,
  type Signer,
  sharesNeeded,
  warehouseBuyer,
} from './swap.ts'

const me = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const E18 = 10n ** 18n
const NOW = Date.UTC(2026, 10, 6, 12)
const TSLA = tokens.tsla.address as Address
const POOL: Address = `0x${'77'.repeat(20)}`
const SOMEONE: Address = `0x${'88'.repeat(20)}`

const transfer = (token: Address, from: Address, to: Address, value: bigint) =>
  ({
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  }) as unknown as Log

// What the swap's receipt shows: the pinned token to the warehouse ('full'), nothing, the token to someone else, or
// another token to the warehouse.
type Fill = 'full' | 'none' | 'elsewhere' | 'other_token'

// TSLA at $400 and a market where $1 of USDG buys `rate` × its worth (1 = fair).
function fakeKyber(opts: { rate?: number; router?: Address } = {}) {
  const routes: bigint[] = []
  let built: Built | undefined
  const out = (amountIn: bigint) =>
    (amountIn * 10n ** 12n * BigInt(Math.round((opts.rate ?? 1) * 1e6))) / (400n * 10n ** 6n)
  const kyber: Kyber = {
    async route(_in, _out, amountIn) {
      routes.push(amountIn)
      return { amountIn: amountIn.toString(), amountOut: out(amountIn).toString(), summary: { amountIn } }
    },
    async build(route: Route) {
      built = {
        amountIn: route.amountIn,
        amountOut: route.amountOut,
        gas: '800000',
        data: '0xe21fd0e9',
        routerAddress: opts.router ?? KYBER_ROUTER,
      }
      return built
    },
  }
  return { kyber, routes, built: () => built }
}

// Robinhood Chain: the warehouse's TSLA (uiMultiplier 1), its USDG allowance, nonces and receipts.
function fakeHood(opts: { fill?: Fill; status?: 'success' | 'reverted'; sendFails?: boolean } = {}) {
  const state = {
    allowance: 0n,
    mined: 0,
    receipts: new Map<Hex, Receipt>(),
    sent: [] as Hex[],
    approvals: [] as bigint[],
    lastOut: 0n,
    sendFails: opts.sendFails ?? false,
  }
  const hood: Hood = {
    async gasPrice() {
      return 20_000_000n
    },
    async usdgAllowance() {
      return state.allowance
    },
    async uiMultiplier() {
      return E18
    },
    async minedNonce() {
      return state.mined
    },
    async receipt(hash) {
      return state.receipts.get(hash) ?? null
    },
    async sendRawTransaction(raw) {
      if (state.sendFails) throw new Error('connection reset')
      state.sent.push(raw)
      const hash = keccak256(raw)
      const tx = parseTransaction(raw)
      state.mined = Math.max(state.mined, (tx.nonce ?? 0) + 1)
      const status = opts.status ?? 'success'
      const logs = {
        full: [transfer(TSLA, POOL, me.address, state.lastOut)],
        none: [],
        elsewhere: [transfer(TSLA, POOL, SOMEONE, state.lastOut)],
        other_token: [transfer(tokens.nvda.address as Address, POOL, me.address, state.lastOut)],
      }[opts.fill ?? 'full']
      state.receipts.set(hash, { status, logs: status === 'success' ? logs : [] })
      return hash
    },
    async waitForReceipt(hash) {
      const r = state.receipts.get(hash)
      if (!r) throw new Error('timeout')
      return r
    },
  }
  return { hood, state }
}

// Signs with a local key, like chainsig.ts's warehouse but without the MPC; the approve updates the allowance.
function fakeSigner(state: ReturnType<typeof fakeHood>['state']) {
  let nonce = 0
  const signed: Hex[] = []
  const signer: Signer = {
    async address() {
      return me.address
    },
    async sign(tx) {
      const raw = await me.signTransaction({ ...tx, nonce: tx.nonce ?? nonce++ })
      signed.push(raw)
      return raw
    },
    async signAndSend(tx) {
      const raw = await signer.sign(tx)
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.data! })
      if (call.functionName === 'approve') {
        state.allowance = call.args[1] as bigint
        state.approvals.push(state.allowance)
      }
      state.mined++
      return { hash: keccak256(raw) }
    },
  }
  return { signer, signed }
}

function setup(o: { rate?: number; router?: Address; fill?: Fill; status?: 'success' | 'reverted' } = {}) {
  const db = openDb(':memory:')
  const k = fakeKyber(o)
  const h = fakeHood(o)
  const s = fakeSigner(h.state)
  // What the swap delivers is what the built route says.
  const kyber: Kyber = {
    route: k.kyber.route,
    async build(route, from, slip) {
      const b = await k.kyber.build(route, from, slip)
      h.state.lastOut = BigInt(b.amountOut)
      return b
    },
  }
  const buyer = warehouseBuyer({
    db,
    hood: h.hood,
    kyber,
    signer: s.signer,
    price: async () => 400,
    now: () => NOW,
  })
  return { db, buyer, ...k, ...h, ...s }
}

const swapRow = (db: Db, id = 'p1:tsla') =>
  one<{ status: string; tx_hash: string; usdg_in: number; attempts: number; error: string }>(
    db,
    'SELECT * FROM warehouse_swaps WHERE id = ?',
    id,
  )

describe('sharesNeeded', () => {
  it('is units × 0.001 share, and the raw amount that shows at least that through balanceOfUI', () => {
    const mult = 1000775159164630595n // NVDA's uiMultiplier on 2026-11-06
    const { needUi, needRaw } = sharesNeeded(7n, mult)
    expect(needUi).toBe(7n * 10n ** 15n)
    expect((needRaw * mult) / E18).toBeGreaterThanOrEqual(needUi)
    expect(((needRaw - 1n) * mult) / E18).toBeLessThan(needUi)
  })

  it('is exact when the multiplier is 1', () => {
    expect(sharesNeeded(3n, E18)).toEqual({ needUi: 3n * 10n ** 15n, needRaw: 3n * 10n ** 15n })
  })
})

describe('buying for a party', () => {
  it('buys enough after slippage, approves exactly that, and returns the swap hash as the proof', async () => {
    const t = setup()
    const proof = await t.buyer.buyShares('p1', 'tsla', 10n) // 0.01 TSLA ≈ $4
    const swap = parseTransaction(t.state.sent[0]!)
    expect(proof).toBe(keccak256(t.state.sent[0]!))
    expect(proof.length).toBeLessThanOrEqual(128)
    expect(swap.to?.toLowerCase()).toBe(KYBER_ROUTER.toLowerCase())
    expect(swap.chainId).toBe(4663)
    expect(swap.gas).toBe(1_200_000n)
    const min = (t.state.lastOut * 9950n) / 10_000n
    expect(min).toBeGreaterThanOrEqual(10n * 10n ** 15n)
    expect(t.state.approvals).toEqual([BigInt(swapRow(t.db)!.usdg_in)])
    expect(swapRow(t.db)).toMatchObject({ status: 'done', tx_hash: proof })
  })

  it('skips the approve when the allowance already covers the swap', async () => {
    const t = setup()
    t.state.allowance = 10n ** 12n
    await t.buyer.buyShares('p1', 'tsla', 10n)
    expect(t.state.approvals).toEqual([])
  })

  it('re-quotes a bigger amount when the first guess comes up short', async () => {
    const t = setup({ rate: 0.995 })
    await t.buyer.buyShares('p1', 'tsla', 10n)
    expect(t.routes.length).toBe(2)
    expect(t.routes[1]!).toBeGreaterThan(t.routes[0]!)
  })

  it('refuses an unknown token', async () => {
    const t = setup()
    await expect(t.buyer.buyShares('p1', 'doge', 1n)).rejects.toMatchObject({ code: 'unknown_token', permanent: true })
  })
})

describe('limits (SPEC §5.3)', () => {
  it('refuses more than $50 in one swap, for good, without signing', async () => {
    const t = setup()
    // 130 units = 0.13 TSLA ≈ $52.5
    await expect(t.buyer.buyShares('p1', 'tsla', 130n)).rejects.toMatchObject({
      code: 'over_swap_limit',
      permanent: true,
    })
    expect(t.signed).toEqual([])
  })

  it('stops at $500 a UTC day across swaps; yesterday does not count', async () => {
    const t = setup()
    const add = (id: string, micro: number, at: number) =>
      run(
        t.db,
        `INSERT INTO warehouse_swaps (id, token, units, usdg_in, need_ui, need_raw, nonce, raw_tx, tx_hash, status, at)
         VALUES (?, 'tsla', 1, ?, '0', '0', 0, '0x', '0x', 'done', ?)`,
        id,
        micro,
        at,
      )
    add('old', 400_000_000, NOW - 86_400_000)
    add('a', 480_000_000, NOW - 1000)
    await expect(t.buyer.buyShares('p1', 'tsla', 50n)).rejects.toMatchObject({ code: 'daily_limit' })
    expect(t.signed).toEqual([])
    await t.buyer.buyShares('p2', 'tsla', 10n) // ≈ $4 still fits
  })

  it('refuses a quote worth more than 2 % under the market price', async () => {
    const t = setup({ rate: 0.97 })
    await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toMatchObject({ code: 'under_market' })
    expect(t.signed).toEqual([])
  })

  it('takes a quote 1 % under the market', async () => {
    const t = setup({ rate: 0.99 })
    await t.buyer.buyShares('p1', 'tsla', 10n)
  })

  it('refuses a route built for another router', async () => {
    const t = setup({ router: `0x${'99'.repeat(20)}` })
    await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toMatchObject({ code: 'wrong_router', permanent: true })
    expect(t.signed).toEqual([])
  })
})

describe('proof only when the shares arrived', () => {
  for (const fill of ['none', 'elsewhere', 'other_token'] as const) {
    it(`a swap that succeeded without the pinned token reaching the warehouse (${fill}) stops for a person`, async () => {
      const t = setup({ fill })
      await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toMatchObject({ code: 'short_fill', permanent: true })
      expect(swapRow(t.db)).toMatchObject({ status: 'stuck', error: 'short_fill' })
      // and stays stopped: no second purchase, no proof from a later look
      await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toMatchObject({ code: 'short_fill', permanent: true })
      expect(t.routes.length).toBe(1)
      expect(t.state.sent.length).toBe(1)
    })
  }

  it('a reverted swap is not a proof, and the next try buys again', async () => {
    const t = setup({ status: 'reverted' })
    await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toMatchObject({ code: 'swap_reverted' })
    expect(swapRow(t.db)).toMatchObject({ status: 'failed', error: 'reverted' })
  })
})

describe('never buying twice', () => {
  it('a crash after signing: the retry rebroadcasts the same transaction, no new quote', async () => {
    const t = setup()
    t.state.sendFails = true
    await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toThrow('connection reset')
    const first = swapRow(t.db)!
    expect(first.status).toBe('sent')
    t.state.sendFails = false
    const proof = await t.buyer.buyShares('p1', 'tsla', 10n)
    expect(proof).toBe(first.tx_hash)
    expect(t.routes.length).toBe(1)
    expect(t.state.sent.length).toBe(1)
  })

  it('a finished buy answers its proof again without touching the chain', async () => {
    const t = setup()
    const proof = await t.buyer.buyShares('p1', 'tsla', 10n)
    const sent = t.state.sent.length
    expect(await t.buyer.buyShares('p1', 'tsla', 10n)).toBe(proof)
    expect(t.state.sent.length).toBe(sent)
    expect(t.routes.length).toBe(1)
  })

  it('a recorded swap with no receipt whose nonce is used: stop for a person, never buy again', async () => {
    const t = setup()
    t.state.sendFails = true
    await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toThrow()
    t.state.mined = 99 // its nonce is used, and no RPC has a receipt for it
    await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toMatchObject({ code: 'swap_dropped', permanent: true })
    t.state.sendFails = false
    await expect(t.buyer.buyShares('p1', 'tsla', 10n)).rejects.toMatchObject({ code: 'swap_dropped', permanent: true })
    expect(swapRow(t.db)).toMatchObject({ status: 'stuck', attempts: 1 })
    expect(t.routes.length).toBe(1)
    expect(t.state.sent.length).toBe(0)
  })

  it('a receipt that a lagging RPC only shows on the second look still counts', async () => {
    const t = setup()
    const first = await t.buyer.buyShares('p1', 'tsla', 10n)
    // pretend the row was left 'sent' by a crash, and the receipt is missing from the first two looks
    run(t.db, "UPDATE warehouse_swaps SET status = 'sent'")
    const receipt = t.state.receipts.get(first as Hex)!
    let looks = 0
    t.hood.receipt = async () => (++looks <= 2 ? null : receipt)
    t.state.mined = 99
    expect(await t.buyer.buyShares('p1', 'tsla', 10n)).toBe(first)
    expect(t.routes.length).toBe(1)
  })

  it('a failed signer check is permanent for the settlement job', async () => {
    const t = setup()
    t.signer.sign = async () => {
      const { ChainsigError } = await import('./chainsig.ts')
      throw new ChainsigError('gas_too_high', 'gas 2000000')
    }
    t.state.allowance = 10n ** 12n
    const err = await t.buyer.buyShares('p1', 'tsla', 10n).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SettlementError)
    expect(err).toMatchObject({ code: 'chainsig_gas_too_high', permanent: true })
  })
})

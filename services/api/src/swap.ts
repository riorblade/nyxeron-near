// Buying the warehouse's shares on Robinhood Chain (SPEC §5.3 steps 3–4): a KyberSwap route USDG → the pinned stock
// token, signed by the warehouse through Chain Signatures, broadcast, and checked by the pinned token's Transfer to the
// warehouse in that very transaction before the swap's hash is handed back as the proof for mint_warehouse.
import { isTokenId, SHARES_PER_UNIT } from '@nyxeron/game'
import {
  type Address,
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  fallback,
  type Hex,
  http,
  isAddressEqual,
  keccak256,
  type Log,
  parseAbi,
  parseEventLogs,
  parseTransaction,
  TransactionReceiptNotFoundError,
  type TransactionSerializableEIP1559,
} from 'viem'
import { z } from 'zod'
import { ChainsigError, DEFAULT_LIMITS, type Limits, USDG } from './chainsig.ts'
import { all, type Db, one, run, tx } from './db.ts'
import { HOOD_MAINNET, type HoodNet } from './hoodnet.ts'
import { type BuyShares, SettlementError } from './settlement.ts'

const E18 = 10n ** 18n
const BPS = 10_000n
const UNITS_PER_SHARE = BigInt(Math.round(1 / SHARES_PER_UNIT)) // 1 unit = 0.001 share

export type SwapLimits = {
  maxSwapMicro: bigint // SPEC §5.3: $50 per swap
  maxDayMicro: bigint // $500 per UTC day, over every swap sent
  maxUnderMarketBps: bigint // refuse a quote worth more than 2 % under the market price
  slippageBps: bigint // the minimum out the router enforces
  sizingBufferBps: bigint // first guess of USDG in, above market
}
export const SWAP_LIMITS: SwapLimits = {
  maxSwapMicro: 50_000_000n,
  maxDayMicro: 500_000_000n,
  maxUnderMarketBps: 200n,
  slippageBps: 50n,
  sizingBufferBps: 100n,
}
const APPROVE_GAS = 80_000n

// What we read and send on Robinhood Chain. A fake in tests.
export type Hood = {
  gasPrice(): Promise<bigint>
  usdgAllowance(owner: Address, spender: Address): Promise<bigint>
  usdgBalance(owner: Address): Promise<bigint>
  ethBalance(owner: Address): Promise<bigint>
  uiMultiplier(token: Address): Promise<bigint>
  // How many of `address`'s transactions are mined (not pending).
  minedNonce(address: Address): Promise<number>
  receipt(hash: Hex): Promise<Receipt | null>
  sendRawTransaction(raw: Hex): Promise<Hex>
  waitForReceipt(hash: Hex): Promise<Receipt>
}
// gasUsed × effectiveGasPrice is what the transaction cost the warehouse in ETH (viem's receipts carry both).
export type Receipt = {
  transactionHash: Hex
  status: 'success' | 'reverted'
  logs: Log[]
  gasUsed?: bigint
  effectiveGasPrice?: bigint
}

export type Route = { amountIn: string; amountOut: string; summary: unknown }
export type Built = { amountIn: string; amountOut: string; gas: string; data: Hex; routerAddress: Address }
// KyberSwap's aggregator. A fake in tests.
export type Kyber = {
  route(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<Route>
  build(route: Route, from: Address, slippageBps: bigint): Promise<Built>
}

// The part of chainsig.ts's warehouse the buyer needs.
export type Signer = {
  address(): Promise<Address>
  sign(tx: TransactionSerializableEIP1559): Promise<Hex>
  signAndSend(tx: TransactionSerializableEIP1559): Promise<{ hash: Hex }>
}

type SwapRow = {
  id: string
  token: string
  units: number
  usdg_in: number
  need_ui: string
  need_raw: string
  nonce: number
  raw_tx: Hex
  tx_hash: Hex
  status: 'building' | 'sent' | 'done' | 'failed' | 'stuck'
  error: string
  attempts: number
  resumes: number
  lease: string
  at: number
}

// A building row older than this was left by a crash (nothing of it was broadcast), so another buy() may take it over.
export const BUILD_LEASE_MS = 5 * 60_000
// Retries that found no receipt for a recorded swap before it stops for a person (each waits up to 2 min).
export const MAX_RESUMES = 3
// How long a buy waits for the warehouse to be topped up (fund.ts ticks every 15 s, 1Click takes ≈ 20 s) or for another
// buy of the same row, before trying again. Waits don't use up the settlement job's attempts.
export const FUNDING_WAIT_MS = 2 * 60_000
export const IN_FLIGHT_WAIT_MS = 30_000
// How often a party waiting on a short-fill halt looks again; it buys as soon as a person has cleared the halt.
export const HALT_WAIT_MS = 5 * 60_000
// Units per swap are sized to this share of the $50 cap, so the sizing buffer and a re-quote stay under it.
const CHUNK_SHARE_BPS = 9_000n

// KyberSwap's MetaAggregationRouterV2 `swap` (selector 0xe21fd0e9, as its /route/build answers on Robinhood Chain).
const ROUTER_ABI = parseAbi([
  'struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }',
  'struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }',
  'function swap(SwapExecutionParams execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
])

/**
 * Decodes the router call Kyber built and checks it does what we asked: USDG in, exactly `amountIn` of it, the pinned
 * token out, to the warehouse, no fee taken, and a minimum out (which the router enforces) that covers what is owed.
 * Returns that minimum. Kyber's own amountOut is only its estimate; this is what the transaction itself promises.
 */
export function checkSwapCall(
  data: Hex,
  want: { from: Address; token: Address; amountIn: bigint; needRaw: bigint; usdg?: Address },
): bigint {
  // A wrong field in a swap call is refused for good. A call that isn't a swap at all may be a passing Kyber change,
  // so that one is retried (it counts against the job's attempts).
  const bad = (what: string): never => {
    throw new SettlementError(`bad_swap_call_${what}`, what !== 'not_swap')
  }
  let desc
  try {
    const call = decodeFunctionData({ abi: ROUTER_ABI, data })
    desc = call.args[0].desc
  } catch {
    return bad('not_swap')
  }
  if (!isAddressEqual(desc.srcToken, want.usdg ?? USDG)) bad('src_token')
  if (!isAddressEqual(desc.dstToken, want.token)) bad('dst_token')
  if (!isAddressEqual(desc.dstReceiver, want.from)) bad('receiver')
  if (desc.amount !== want.amountIn) bad('amount')
  if (desc.srcAmounts.reduce((sum, a) => sum + a, 0n) > want.amountIn) bad('src_amounts')
  if (desc.feeReceivers.length > 0 || desc.feeAmounts.some((f) => f > 0n)) bad('fee')
  if (desc.permit !== '0x') bad('permit')
  if (desc.minReturnAmount < want.needRaw) bad('min_return')
  return desc.minReturnAmount
}

/** units × 0.001 share, in balanceOfUI's 18 decimals, and the raw balanceOf amount that shows as at least that. */
export function sharesNeeded(units: bigint, uiMultiplier: bigint): { needUi: bigint; needRaw: bigint } {
  if (units <= 0n) throw new SettlementError('bad_units', true)
  if (uiMultiplier <= 0n) throw new SettlementError('bad_multiplier', true)
  const needUi = (units * E18) / UNITS_PER_SHARE
  // balanceOfUI = balanceOf × uiMultiplier / 1e18, rounded down: round the raw amount up.
  const needRaw = (needUi * E18 + uiMultiplier - 1n) / uiMultiplier
  return { needUi, needRaw }
}

const utcDay = (ms: number) => Math.floor(ms / 86_400_000)
const codeOf = (e: unknown) => (e instanceof SettlementError ? e.code : (e as Error)?.message || 'error')

export function warehouseBuyer(deps: {
  db: Db
  hood: Hood
  kyber: Kyber
  signer: Signer
  // USD per token (balanceOf / 1e18) from the market, e.g. quotes.ts's spot.
  price: (token: string) => Promise<number>
  limits?: SwapLimits
  gasLimits?: Limits
  // Which Robinhood Chain: mainnet (Kyber, Robinhood's tokens) or testnet (our synthetic market). hoodnet.ts.
  net?: HoodNet
  now?: () => number
  log?: (msg: string) => void
}) {
  const { db, hood, kyber, signer } = deps
  const net = deps.net ?? HOOD_MAINNET
  const USDG_ = net.usdg
  const ROUTER = net.router
  const limits = deps.limits ?? SWAP_LIMITS
  const gasLimits = deps.gasLimits ?? DEFAULT_LIMITS
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  let leases = 0

  const spentToday = (except = '') => {
    const today = utcDay(now())
    return all<{ usdg_in: number }>(
      db,
      // A stuck swap may have spent its USDG: it counts until a person resolves it. A building one is about to.
      `SELECT usdg_in FROM warehouse_swaps
        WHERE status IN ('building', 'sent', 'done', 'stuck') AND at >= ? AND id != ?`,
      today * 86_400_000,
      except,
    ).reduce((sum, r) => sum + BigInt(r.usdg_in), 0n)
  }

  async function fees() {
    const price = await hood.gasPrice()
    const fee = price * 2n < gasLimits.maxFeePerGas ? price * 2n : gasLimits.maxFeePerGas
    return { maxFeePerGas: fee, maxPriorityFeePerGas: 0n }
  }

  const rowOf = (id: string) => one<SwapRow>(db, 'SELECT * FROM warehouse_swaps WHERE id = ?', id)

  // A state only a person can resolve (did USDG leave or not?). Every later call stops here, it never buys again.
  const stuck = (id: string, code: string): never => {
    run(db, "UPDATE warehouse_swaps SET status = 'stuck', error = ? WHERE id = ?", code, id)
    throw new SettlementError(code, true)
  }

  // The swap row's transaction landed: the pinned token must have moved what is owed to the warehouse in this very
  // transaction (not just "the balance went up", which another party's swap could also cause). Then it is the proof.
  function finish(row: SwapRow, receipt: Receipt, tokenAddr: Address, from: Address): string {
    // A receipt for another transaction (a replacement at the same nonce) proves nothing about this one.
    if (receipt.transactionHash.toLowerCase() !== row.tx_hash.toLowerCase()) stuck(row.id, 'receipt_mismatch')
    const got = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })
      .filter((l) => isAddressEqual(l.address, tokenAddr) && isAddressEqual(l.args.to, from))
      .reduce((sum, l) => sum + l.args.value, 0n)
    // The swap succeeded but the shares didn't come (blocked, burned, wrong token): a person has to look, and no swap
    // is sent for any party until then.
    if (got < BigInt(row.need_raw)) stuck(row.id, 'short_fill')
    // What it cost in gas, so fund.ts can tell a delivery from the swaps' spending (none recorded counts as none).
    const gasWei = (receipt.gasUsed ?? 0n) * (receipt.effectiveGasPrice ?? 0n)
    run(
      db,
      "UPDATE warehouse_swaps SET status = 'done', error = '', gas_wei = ? WHERE id = ?",
      gasWei.toString(),
      row.id,
    )
    log(`warehouse bought ${row.need_ui} ${row.token} (ui, 18 dp) for ${row.usdg_in} µUSDG: ${row.tx_hash}`)
    return row.tx_hash
  }

  // A swap we signed and recorded earlier: wait for it or rebroadcast it. Undefined = it reverted (no USDG left).
  async function resume(row: SwapRow, tokenAddr: Address, from: Address): Promise<string | undefined> {
    run(db, 'UPDATE warehouse_swaps SET resumes = resumes + 1 WHERE id = ?', row.id)
    let receipt = await hood.receipt(row.tx_hash)
    if (!receipt) {
      try {
        await hood.sendRawTransaction(row.raw_tx)
      } catch (e) {
        // "already known" or "nonce too low": decided below by the receipt and the mined nonce.
        log(`rebroadcast ${row.tx_hash}: ${(e as Error).message}`)
      }
      receipt = await hood.receipt(row.tx_hash)
      // Its nonce is used and it still has no receipt. Most likely it never ran, but a lagging RPC looks the same, and
      // guessing wrong buys twice: stop for a person instead of buying again.
      if (!receipt && (await hood.minedNonce(from)) > row.nonce && !(await hood.receipt(row.tx_hash)))
        stuck(row.id, 'swap_dropped')
      if (!receipt) {
        try {
          receipt = await hood.waitForReceipt(row.tx_hash)
        } catch (e) {
          // Refused or dropped with its nonce still free: every retry would wait here again. Stop for a person.
          if (row.resumes + 1 >= MAX_RESUMES) stuck(row.id, 'swap_unconfirmed')
          throw e
        }
      }
    }
    if (receipt.transactionHash.toLowerCase() !== row.tx_hash.toLowerCase()) stuck(row.id, 'receipt_mismatch')
    if (receipt.status !== 'success') {
      run(db, "UPDATE warehouse_swaps SET status = 'failed', error = 'reverted' WHERE id = ?", row.id)
      return undefined
    }
    return finish(row, receipt, tokenAddr, from)
  }

  // Takes the row for this buy() (synchronously, so two calls can't both get it): new, failed, or a building row a
  // crash left. Anything else is another buy() at work.
  function reserve(id: string, token: string, units: bigint): string {
    return tx(db, () => {
      const row = rowOf(id)
      const free = !row || row.status === 'failed' || (row.status === 'building' && now() - row.at >= BUILD_LEASE_MS)
      if (!free) throw new SettlementError('swap_in_flight', false, now() + IN_FLIGHT_WAIT_MS)
      const lease = `${process.pid}-${now()}-${++leases}`
      run(
        db,
        `INSERT INTO warehouse_swaps (id, token, units, usdg_in, need_ui, need_raw, nonce, raw_tx, tx_hash, status, lease, at)
         VALUES (?, ?, ?, 0, '', '', -1, '', '', 'building', ?, ?)
         ON CONFLICT (id) DO UPDATE SET units = excluded.units, usdg_in = 0, status = 'building', error = '',
           resumes = 0, lease = excluded.lease, at = excluded.at, attempts = attempts + 1`,
        id,
        token,
        Number(units),
        lease,
        now(),
      )
      return lease
    })
  }

  // One swap of `units`, under row `id`.
  async function buyOne(id: string, token: string, tokenAddr: Address, units: bigint, from: Address): Promise<string> {
    const prior = rowOf(id)
    if (prior?.status === 'done') return prior.tx_hash
    if (prior?.status === 'stuck') throw new SettlementError(prior.error, true)
    if (prior?.status === 'sent') {
      const proof = await resume(prior, tokenAddr, from)
      if (proof) return proof
    }

    // A swap that succeeded without delivering the shares: something is wrong with the route or the token, so no new
    // swap is sent for any party until a person has looked (and moved that row out of 'stuck'). Finished and
    // already-sent swaps above still answer.
    if (one(db, "SELECT 1 FROM warehouse_swaps WHERE status = 'stuck' AND error = 'short_fill' LIMIT 1"))
      throw new SettlementError('halted_short_fill', false, now() + HALT_WAIT_MS)
    const lease = reserve(id, token, units)
    const mine = `id = ? AND status = 'building' AND lease = ?`
    let raw: Hex, hash: Hex
    try {
      const { needUi, needRaw } = sharesNeeded(units, await hood.uiMultiplier(tokenAddr))
      const spot = await deps.price(token)
      if (!Number.isFinite(spot) || spot <= 0) throw new SettlementError('no_price')
      // The market price in micro-USDG per whole token; from here on everything is integers.
      const priceMicro = BigInt(Math.round(spot * 1_000_000))
      const worthMicro = (raw: bigint) => (raw * priceMicro) / E18

      // Size USDG in so the minimum out (after slippage) covers what is owed.
      const keep = (out: bigint) => (out * (BPS - limits.slippageBps)) / BPS
      let amountIn = (worthMicro(needRaw) * (BPS + limits.sizingBufferBps)) / BPS + 1n
      let route = await kyber.route(USDG_, tokenAddr, amountIn)
      if (keep(BigInt(route.amountOut)) < needRaw) {
        const out = keep(BigInt(route.amountOut))
        if (out <= 0n) throw new SettlementError('short_quote')
        amountIn = (amountIn * needRaw * 1002n) / (out * 1000n) + 1n
        route = await kyber.route(USDG_, tokenAddr, amountIn)
      }
      if (keep(BigInt(route.amountOut)) < needRaw) throw new SettlementError('short_quote')

      // Units were sized to 90 % of the cap at our price, so this means Kyber's price is > 10 % off it: retried (and
      // sized again), counted against the job's attempts. A unit too big for any swap is refused for good earlier.
      if (amountIn > limits.maxSwapMicro) throw new SettlementError('over_swap_limit')
      // The day's cap and this row's share of it in one step, so two buys can't both fit in the same room.
      tx(db, () => {
        if (spentToday(id) + amountIn > limits.maxDayMicro)
          throw new SettlementError('daily_limit', false, (utcDay(now()) + 1) * 86_400_000)
        if (run(db, `UPDATE warehouse_swaps SET usdg_in = ? WHERE ${mine}`, Number(amountIn), id, lease) !== 1)
          throw new SettlementError('swap_in_flight', false, now() + IN_FLIGHT_WAIT_MS)
      })

      const built = await kyber.build(route, from, limits.slippageBps)
      if (!isAddressEqual(built.routerAddress, ROUTER)) throw new SettlementError('wrong_router', true)
      // What the router will enforce, not Kyber's estimate, against what is owed and the 2 % rule.
      const minOut = checkSwapCall(built.data, { from, token: tokenAddr, amountIn, needRaw, usdg: USDG_ })
      if (worthMicro(minOut) * BPS < amountIn * (BPS - limits.maxUnderMarketBps))
        throw new SettlementError('under_market')

      const fee = await fees()
      const swapGas = (BigInt(built.gas) * 3n) / 2n
      // Exactly this swap's amount every time: an allowance left by a swap that reverted is never more than the swap
      // checked above.
      const approve = (await hood.usdgAllowance(from, ROUTER)) !== amountIn
      // Nothing is signed that the warehouse can't pay: a swap without the USDG reverts and still burns gas. Retryable:
      // fund.ts tops the warehouse up from the treasury.
      if ((await hood.ethBalance(from)) < (swapGas + (approve ? APPROVE_GAS : 0n)) * fee.maxFeePerGas)
        throw new SettlementError('warehouse_low_eth', false, now() + FUNDING_WAIT_MS)
      if ((await hood.usdgBalance(from)) < amountIn)
        throw new SettlementError('warehouse_low_usdg', false, now() + FUNDING_WAIT_MS)
      if (approve) {
        await signer.signAndSend({
          type: 'eip1559',
          chainId: net.chainId,
          to: USDG_,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER, amountIn] }),
          value: 0n,
          gas: APPROVE_GAS,
          ...fee,
        })
      }

      raw = await signer.sign({
        type: 'eip1559',
        chainId: net.chainId,
        to: built.routerAddress,
        data: built.data,
        value: 0n,
        gas: swapGas,
        ...fee,
      })
      hash = keccak256(raw)
      const nonce = parseTransaction(raw).nonce ?? 0
      // Recorded before it is broadcast: from here on, a retry checks this transaction instead of buying again. Only
      // while this call still holds the row; otherwise it was taken over and this transaction is never sent.
      const recorded = run(
        db,
        `UPDATE warehouse_swaps SET usdg_in = ?, need_ui = ?, need_raw = ?, nonce = ?, raw_tx = ?, tx_hash = ?,
           status = 'sent', at = ? WHERE ${mine}`,
        Number(amountIn),
        needUi.toString(),
        needRaw.toString(),
        nonce,
        raw,
        hash,
        now(),
        id,
        lease,
      )
      if (recorded !== 1) throw new SettlementError('swap_in_flight', false, now() + IN_FLIGHT_WAIT_MS)
    } catch (e) {
      // Nothing was sent: free the row for the next try.
      run(db, `UPDATE warehouse_swaps SET status = 'failed', error = ? WHERE ${mine}`, codeOf(e), id, lease)
      throw e
    }

    await hood.sendRawTransaction(raw)
    const receipt = await hood.waitForReceipt(hash)
    const row = rowOf(id)!
    if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) stuck(id, 'receipt_mismatch')
    if (receipt.status !== 'success') {
      run(db, "UPDATE warehouse_swaps SET status = 'failed', error = 'reverted' WHERE id = ?", id)
      throw new SettlementError('swap_reverted')
    }
    return finish(row, receipt, tokenAddr, from)
  }

  // How many units one swap may cover: what fits in CHUNK_SHARE_BPS of the $50 cap at the market price.
  async function unitsPerSwap(token: string, tokenAddr: Address): Promise<bigint> {
    const spot = await deps.price(token)
    if (!Number.isFinite(spot) || spot <= 0) throw new SettlementError('no_price')
    const { needRaw } = sharesNeeded(1n, await hood.uiMultiplier(tokenAddr))
    const unitMicro = (needRaw * BigInt(Math.round(spot * 1_000_000)) + E18 - 1n) / E18
    const n = (limits.maxSwapMicro * CHUNK_SHARE_BPS) / BPS / unitMicro
    if (n < 1n) throw new SettlementError('over_swap_limit', true)
    return n
  }

  /**
   * Buys what a party owes of one token, in as many swaps of ≤ $50 as it takes (rows `<party>:<token>`, then
   * `<party>:<token>:1`, …). The proof is the first swap's hash, plus `+<n>` when n more swaps were needed.
   */
  async function buy(party: string, token: string, units: bigint): Promise<string> {
    if (!isTokenId(token)) throw new SettlementError('unknown_token', true)
    if (units <= 0n) throw new SettlementError('bad_units', true)
    const tokenAddr = net.tokens[token]
    const from = await signer.address()

    const hashes: string[] = []
    let left = units
    for (let n = 0; left > 0n; n++) {
      const id = n === 0 ? `${party}:${token}` : `${party}:${token}:${n}`
      const prior = rowOf(id)
      // A swap already under way keeps its size; a new (or failed) one is sized now.
      let size = prior && prior.status !== 'failed' ? BigInt(prior.units) : 0n
      if (size <= 0n) {
        const most = await unitsPerSwap(token, tokenAddr)
        size = most < left ? most : left
      }
      hashes.push(await buyOne(id, token, tokenAddr, size, from))
      left -= size
    }
    return hashes.length === 1 ? hashes[0]! : `${hashes[0]}+${hashes.length - 1}`
  }

  // settlement.ts's BuyShares; signer errors (a check refused, the MPC answer) are not worth retrying blindly.
  const buyShares: BuyShares = async (party, token, units) => {
    try {
      return await buy(party, token, units)
    } catch (e) {
      if (e instanceof ChainsigError && e.code !== 'reverted') throw new SettlementError(`chainsig_${e.code}`, true)
      throw e
    }
  }

  return { buy, buyShares, spentToday }
}

const STOCK_ABI = parseAbi(['function uiMultiplier() view returns (uint256)'])

export function robinhoodHood(net: HoodNet = HOOD_MAINNET): Hood {
  const client = createPublicClient({
    transport: fallback(net.rpcs.map((url) => http(url, { timeout: 15_000 }))),
  })
  return {
    gasPrice: () => client.getGasPrice(),
    usdgAllowance: (owner, spender) =>
      client.readContract({ address: net.usdg, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] }),
    usdgBalance: (owner) =>
      client.readContract({ address: net.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    ethBalance: (address) => client.getBalance({ address }),
    uiMultiplier: (token) => client.readContract({ address: token, abi: STOCK_ABI, functionName: 'uiMultiplier' }),
    minedNonce: (address) => client.getTransactionCount({ address, blockTag: 'latest' }),
    async receipt(hash) {
      try {
        return await client.getTransactionReceipt({ hash })
      } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null
        throw e
      }
    },
    sendRawTransaction: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
    waitForReceipt: (hash) => client.waitForTransactionReceipt({ hash, timeout: 120_000 }),
  }
}

const KYBER_API = 'https://aggregator-api.kyberswap.com/robinhood/api/v1'
const RouteAnswer = z.object({
  code: z.literal(0),
  data: z.object({
    routeSummary: z.looseObject({ amountIn: z.string().regex(/^\d+$/), amountOut: z.string().regex(/^\d+$/) }),
  }),
})
const BuildAnswer = z.object({
  code: z.literal(0),
  data: z.object({
    amountIn: z.string().regex(/^\d+$/),
    amountOut: z.string().regex(/^\d+$/),
    gas: z.string().regex(/^\d+$/),
    data: z.string().regex(/^0x[0-9a-fA-F]+$/),
    routerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
})

// KyberSwap's public aggregator for Robinhood Chain (no key; spikes 15, 16).
export function kyberSwap(opts: { fetch?: typeof fetch; clientId?: string } = {}): Kyber {
  const doFetch = opts.fetch ?? fetch
  const headers = { 'x-client-id': opts.clientId ?? 'nyxeron' }
  return {
    async route(tokenIn, tokenOut, amountIn) {
      const res = await doFetch(`${KYBER_API}/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
      const parsed = RouteAnswer.safeParse(await res.json().catch(() => null))
      if (!res.ok || !parsed.success) throw new SettlementError(`kyber_route_${res.status}`)
      const s = parsed.data.data.routeSummary
      return { amountIn: s.amountIn, amountOut: s.amountOut, summary: s }
    },
    async build(route, from, slippageBps) {
      const res = await doFetch(`${KYBER_API}/route/build`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          routeSummary: route.summary,
          sender: from,
          recipient: from,
          slippageTolerance: Number(slippageBps),
          // The approve may not be mined yet; the router itself enforces the minimum out.
          skipSimulateTx: true,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const parsed = BuildAnswer.safeParse(await res.json().catch(() => null))
      if (!res.ok || !parsed.success) throw new SettlementError(`kyber_build_${res.status}`)
      const d = parsed.data.data
      return { ...d, data: d.data as Hex, routerAddress: d.routerAddress as Address }
    },
  }
}

// Funding the warehouse on Robinhood Chain (SPEC §5.3 step 2): the treasury's USDC on NEAR goes through NEAR Intents
// 1Click to the warehouse's address as USDG (what swap.ts spends) and a little ETH (its gas). The warehouse is kept above
// a floor of each, one deposit in flight per asset; every deposit is recorded before it is sent, and a state where we
// can't tell whether USDC left stops as `stuck` for a person instead of sending again.
import { Account, actions, type KeyPairString, nearToYocto, teraToGas } from 'near-api-js'
import { type Address, isAddressEqual } from 'viem'
import { z } from 'zod'
import { USDG } from './chainsig.ts'
import type { Config } from './config.ts'
import { all, type Db, one, run } from './db.ts'
import { type OneClick, type OneClickToken, QUOTE_VALID_MS } from './intents.ts'
import { nearProvider, type RelayResult, summarise } from './near.ts'

const BPS = 10_000n
const TOKENS_TTL_MS = 10 * 60_000
const STATUS_EVERY_MS = 10_000

export type FundAsset = 'usdg' | 'eth'
export type FundLimits = {
  usdgFloor: bigint // micro-USDG: refill below this (one $50 swap and some room)
  usdgRefill: bigint // micro-USDC sent per USDG refill
  ethFloor: bigint // wei: refill below this
  ethRefill: bigint // micro-USDC sent per ETH refill
  minRefill: bigint // micro-USDC: 1Click's flat withdraw fee makes a smaller deposit too costly
  maxDay: bigint // micro-USDC over every refill of a UTC day
  maxLossBps: bigint // the quote's minimum out must be worth at least 97 % of the USDC sent
  slippageBps: number
}
export const FUND_LIMITS: FundLimits = {
  usdgFloor: 60_000_000n,
  usdgRefill: 100_000_000n,
  // ≈ 6 swaps at 0.00003 ETH (1.2M gas at 0.04 gwei, 2026-11-07); $5 buys ≈ 0.002 ETH.
  ethFloor: 200_000_000_000_000n,
  ethRefill: 5_000_000n,
  minRefill: 5_000_000n,
  maxDay: 600_000_000n,
  maxLossBps: 300n,
  slippageBps: 100,
}

// The treasury on NEAR: the contract's `treasury` (released wholesale lands there), holding USDC. A fake in tests.
export type Treasury = {
  accountId: string
  usdcBalance(): Promise<bigint>
  isRegistered(accountId: string): Promise<boolean>
  // One transaction on USDC: storage_deposit for `to` when `register`, then ft_transfer of `amount` to it.
  deposit(to: string, amount: bigint, register: boolean): Promise<RelayResult>
}
// What the funder reads on Robinhood Chain (swap.ts's Hood has both).
export type WarehouseBalances = {
  usdgBalance(owner: Address): Promise<bigint>
  ethBalance(owner: Address): Promise<bigint>
}

type Listed = OneClickToken & { contractAddress?: string }
type FundRow = {
  id: string
  asset: FundAsset
  amount_in: number
  min_out: string
  deposit_address: string
  status: 'quoted' | 'sent' | 'done' | 'refunded' | 'failed' | 'stuck'
  oneclick_status: string
  deposit_tx: string
  error: string
  deadline: number
  checked_at: number
  created_at: number
}

// Only the fields we check; 1Click echoes the request it quoted, so recipient and assets are checked on its answer.
const QuoteAnswer = z.object({
  correlationId: z.string().optional(),
  quote: z.object({
    depositAddress: z.string().regex(/^[0-9a-f]{64}$/), // an implicit NEAR account: USDC is sent there
    depositMemo: z.string().nullish(),
    amountIn: z.string().regex(/^\d+$/),
    minAmountOut: z.string().regex(/^\d+$/),
    deadline: z.string(),
  }),
  quoteRequest: z.looseObject({
    originAsset: z.string(),
    destinationAsset: z.string(),
    recipient: z.string(),
    refundTo: z.string(),
  }),
})

export class FundError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

const utcDay = (ms: number) => Math.floor(ms / 86_400_000)

export function warehouseFunder(deps: {
  db: Db
  oneclick: OneClick
  treasury: Treasury
  chain: WarehouseBalances
  warehouse: () => Promise<Address>
  usdcId: string // the treasury's USDC contract (mainnet)
  limits?: FundLimits
  now?: () => number
  log?: (msg: string) => void
}) {
  const { db, oneclick, treasury, chain } = deps
  const limits = deps.limits ?? FUND_LIMITS
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const usdcAsset = `nep141:${deps.usdcId}`
  let tokens: { at: number; list: Listed[] } | undefined
  let running = false

  const spentToday = () =>
    all<{ amount_in: number }>(
      db,
      // Everything but a deposit that failed on chain (nothing moved) counts, refunds too: a route that keeps
      // refunding must not loop.
      "SELECT amount_in FROM warehouse_funding WHERE status <> 'failed' AND created_at >= ?",
      utcDay(now()) * 86_400_000,
    ).reduce((sum, r) => sum + BigInt(r.amount_in), 0n)

  const set = (id: string, fields: Partial<FundRow>) => {
    const keys = Object.keys(fields)
    run(
      db,
      `UPDATE warehouse_funding SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...keys.map((k) => fields[k as keyof FundRow] as string | number),
      id,
    )
  }
  const stuck = (row: Pick<FundRow, 'id' | 'asset'>, code: string) => {
    set(row.id, { status: 'stuck', error: code })
    log(
      `warehouse funding ${row.id} (${row.asset}) stuck: ${code}; a person checks it, no ${row.asset} refill until then`,
    )
  }

  async function listed(): Promise<Listed[]> {
    if (!tokens || now() - tokens.at >= TOKENS_TTL_MS) tokens = { at: now(), list: await oneclick.tokens() }
    return tokens.list
  }
  // Pinned by what they are on Robinhood Chain, not by symbol alone: USDG by its contract, ETH as the native coin.
  async function target(asset: FundAsset): Promise<Listed> {
    const list = await listed()
    const t =
      asset === 'usdg'
        ? list.find(
            (x) =>
              x.blockchain === 'hood' &&
              x.decimals === 6 &&
              typeof x.contractAddress === 'string' &&
              /^0x[0-9a-fA-F]{40}$/.test(x.contractAddress) &&
              isAddressEqual(x.contractAddress as Address, USDG),
          )
        : list.find((x) => x.blockchain === 'hood' && x.symbol === 'ETH' && x.decimals === 18 && !x.contractAddress)
    if (!t) throw new FundError('asset_not_listed')
    if (!list.some((x) => x.assetId === usdcAsset)) throw new FundError('usdc_not_listed')
    return t
  }

  // 1Click's answer for exactly this deposit: our USDC in, `to` out to the warehouse, refunds to the treasury, and
  // what arrives at worst worth at least 97 % of what we send.
  function check(answer: unknown, to: Listed, amount: bigint, warehouse: Address) {
    const parsed = QuoteAnswer.safeParse(answer)
    if (!parsed.success) throw new FundError('bad_quote')
    const { quote, quoteRequest: req } = parsed.data
    if (!/^0x[0-9a-fA-F]{40}$/.test(req.recipient) || !isAddressEqual(req.recipient as Address, warehouse))
      throw new FundError('wrong_recipient')
    if (req.originAsset !== usdcAsset || req.destinationAsset !== to.assetId) throw new FundError('wrong_asset')
    if (req.refundTo !== treasury.accountId) throw new FundError('wrong_refund')
    if (quote.amountIn !== amount.toString()) throw new FundError('wrong_amount')
    if (quote.depositMemo) throw new FundError('memo_not_supported')
    const deadline = Date.parse(quote.deadline)
    if (!Number.isFinite(deadline) || deadline <= now()) throw new FundError('bad_quote')
    const price = Number(to.price)
    if (!Number.isFinite(price) || price <= 0) throw new FundError('no_price')
    const worth = (BigInt(quote.minAmountOut) * BigInt(Math.round(price * 1_000_000))) / 10n ** BigInt(to.decimals)
    if (worth * BPS < amount * (BPS - limits.maxLossBps)) throw new FundError('too_costly')
    return { id: parsed.data.correlationId ?? quote.depositAddress, quote, deadline }
  }

  // One deposit: quote, check, record, send. Returns true when a transaction was (or may have been) sent.
  async function refill(asset: FundAsset, warehouse: Address): Promise<boolean> {
    const to = await target(asset)
    const want = asset === 'usdg' ? limits.usdgRefill : limits.ethRefill
    const held = await treasury.usdcBalance()
    const amount = held < want ? held : want
    if (amount < limits.minRefill) throw new FundError('treasury_low')
    if (spentToday() + amount > limits.maxDay) throw new FundError('daily_limit')
    let answer: unknown
    try {
      answer = await oneclick.quote({
        dry: false,
        swapType: 'EXACT_INPUT',
        slippageTolerance: limits.slippageBps,
        originAsset: usdcAsset,
        destinationAsset: to.assetId,
        amount: amount.toString(),
        depositType: 'ORIGIN_CHAIN',
        refundTo: treasury.accountId,
        refundType: 'ORIGIN_CHAIN',
        recipient: warehouse,
        recipientType: 'DESTINATION_CHAIN',
        deadline: new Date(now() + QUOTE_VALID_MS).toISOString(),
        quoteWaitingTimeMs: 3000,
        referral: 'nyxeron',
      })
    } catch (e) {
      throw new FundError(`quote_failed: ${(e as Error).message}`.slice(0, 200))
    }
    const q = check(answer, to, amount, warehouse)
    const address = q.quote.depositAddress
    // 1Click's deposit addresses are fresh implicit accounts USDC doesn't know: register in the same transaction.
    const register = !(await treasury.isRegistered(address))
    // Recorded before it is sent: from here on a crash or a lost answer stops for a person, never sends twice.
    run(
      db,
      `INSERT INTO warehouse_funding (id, asset, amount_in, min_out, deposit_address, status, deadline, checked_at,
         created_at) VALUES (?, ?, ?, ?, ?, 'quoted', ?, 0, ?)`,
      q.id,
      asset,
      Number(amount),
      q.quote.minAmountOut,
      address,
      q.deadline,
      now(),
    )
    let sent: RelayResult
    try {
      sent = await treasury.deposit(address, amount, register)
    } catch (e) {
      stuck({ id: q.id, asset }, 'deposit_unknown')
      log(`warehouse funding ${q.id}: ${(e as Error).message}`)
      return true
    }
    if (!sent.ok) {
      // Failed on chain: the transaction's actions revert together, no USDC moved.
      set(q.id, { status: 'failed', deposit_tx: sent.hash, error: (sent.error ?? 'failed').slice(0, 300) })
      log(`warehouse funding ${q.id} (${asset}) failed on chain: ${sent.error}`)
      return true
    }
    set(q.id, { status: 'sent', deposit_tx: sent.hash })
    log(`warehouse funding: ${amount} µUSDC → ${asset} for ${warehouse}, deposit ${sent.hash}`)
    await oneclick
      .submitDeposit({ txHash: sent.hash, depositAddress: address, nearSenderAccount: treasury.accountId })
      .catch((e: unknown) => log(`1click deposit/submit: ${(e as Error).message}`))
    return true
  }

  // A sent deposit: 1Click's status, at most every 10 s, until it delivered or refunded.
  async function follow(row: FundRow) {
    if (now() - row.checked_at < STATUS_EVERY_MS) return
    let status: string
    try {
      status = (await oneclick.status(row.deposit_address)).status
    } catch {
      return // asked again next time
    }
    set(row.id, { oneclick_status: status, checked_at: now() })
    if (status === 'SUCCESS') {
      set(row.id, { status: 'done' })
      log(`warehouse funding ${row.id} (${row.asset}) delivered`)
    } else if (status === 'REFUNDED') {
      set(row.id, { status: 'refunded' })
      log(`warehouse funding ${row.id} (${row.asset}) refunded to the treasury`)
    } else if (status === 'FAILED' || status === 'INCOMPLETE_DEPOSIT') stuck(row, status.toLowerCase())
    else if (now() > row.deadline) stuck(row, 'past_deadline')
  }

  /** At most one deposit per call: ETH first (nothing moves without gas), then USDG. Safe to call on a timer. */
  async function tick(): Promise<void> {
    if (running) return
    running = true
    try {
      const warehouse = await deps.warehouse()
      for (const asset of ['eth', 'usdg'] as const) {
        const open = one<FundRow>(
          db,
          "SELECT * FROM warehouse_funding WHERE asset = ? AND status IN ('quoted', 'sent', 'stuck') ORDER BY created_at",
          asset,
        )
        // A row still 'quoted' at the start of a tick was being sent when the process stopped: did USDC leave?
        if (open?.status === 'quoted') stuck(open, 'deposit_unknown')
        if (open?.status === 'sent') await follow(open)
        if (open && one(db, "SELECT 1 FROM warehouse_funding WHERE id = ? AND status IN ('sent', 'stuck')", open.id))
          continue
        const have = asset === 'usdg' ? await chain.usdgBalance(warehouse) : await chain.ethBalance(warehouse)
        if (have >= (asset === 'usdg' ? limits.usdgFloor : limits.ethFloor)) continue
        try {
          if (await refill(asset, warehouse)) return
        } catch (e) {
          log(`warehouse funding (${asset}) not sent: ${e instanceof FundError ? e.code : (e as Error).message}`)
        }
      }
    } finally {
      running = false
    }
  }

  return { tick, spentToday }
}

// The treasury account with a full-access key: ft_transfer needs 1 yoctoNEAR, which a function-call key can't attach.
export function nearTreasury(opts: {
  network: Config['NEAR_NETWORK']
  accountId: string
  key: string
  usdcId: string
}): Treasury {
  const provider = nearProvider(opts.network)
  const account = new Account(opts.accountId, provider, opts.key as KeyPairString)
  const usdc = opts.usdcId
  return {
    accountId: opts.accountId,
    async usdcBalance() {
      const raw = await provider.callFunction<string>({
        contractId: usdc,
        method: 'ft_balance_of',
        args: { account_id: opts.accountId },
      })
      return BigInt(raw ?? 0)
    },
    async isRegistered(accountId) {
      const b = await provider.callFunction({
        contractId: usdc,
        method: 'storage_balance_of',
        args: { account_id: accountId },
      })
      return b !== null && b !== undefined
    },
    async deposit(to, amount, register) {
      const o = await account.signAndSendTransaction({
        receiverId: usdc,
        actions: [
          ...(register
            ? [
                actions.functionCall(
                  'storage_deposit',
                  { account_id: to, registration_only: true },
                  teraToGas('30'),
                  nearToYocto('0.00125'),
                ),
              ]
            : []),
          actions.functionCall('ft_transfer', { receiver_id: to, amount: amount.toString() }, teraToGas('50'), 1n),
        ],
      })
      return summarise(o as unknown as Parameters<typeof summarise>[0])
    },
  }
}

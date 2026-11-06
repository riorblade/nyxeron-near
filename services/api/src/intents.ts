// Add money and Cash out through NEAR Intents 1Click (SPEC §5.1, spike 05). Non-custodial both ways: a top-up lands in
// the player's own NEAR account, and a cash-out is a USDC transfer the player signs to 1Click's deposit address.
// 1Click has no testnet (SPEC §10): there every quote is a dry run against mainnet asset ids, with nothing to sign.
import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, requireActive, type User } from './auth.ts'
import { type Config, USDC_BY_NETWORK } from './config.ts'
import { all, type Db, one, run } from './db.ts'
import { AppError, rateLimit, validate } from './http.ts'

export const ONECLICK_URL = 'https://1click.chaindefuser.com'
export const QUOTE_VALID_MS = 10 * 60_000 // 1Click's deposit window
const TOKENS_TTL_MS = 10 * 60_000
const STATUS_TTL_MS = 10_000
const SLIPPAGE_BPS = 100 // 1 %, as in spike 05
export const CASH_OUT_MIN = 1_000_000n // $1 (micro-USDC): below it fees eat the payout
export const CASH_OUT_MAX = 1_000_000_000n // $1,000
const ADD_MONEY_MAX_USD = 1_000
// The player's signed deposit: USDC ft_transfer to the deposit address (skill deposit-near), relayed by us.
export const CASH_OUT_GAS = '50000000000000'
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT'])

export type OneClickToken = {
  assetId: string
  decimals: number
  blockchain: string
  symbol: string
  price?: number | string
}
export type QuoteRequest = {
  dry: boolean
  swapType: 'EXACT_INPUT'
  slippageTolerance: number
  originAsset: string
  destinationAsset: string
  amount: string
  depositType: 'ORIGIN_CHAIN'
  refundTo: string
  refundType: 'ORIGIN_CHAIN'
  recipient: string
  recipientType: 'DESTINATION_CHAIN'
  deadline: string
  quoteWaitingTimeMs: number
  referral: string
}
export type OneClickQuote = {
  correlationId?: string
  quote: {
    depositAddress?: string
    depositMemo?: string | null
    amountIn: string
    amountInFormatted?: string
    amountOut: string
    amountOutFormatted?: string
    minAmountOut?: string
    deadline?: string
    timeEstimate?: number
  }
}
export type OneClickStatus = { status: string; swapDetails?: Record<string, unknown> }

// What we use of 1Click. A fake in tests.
export type OneClick = {
  tokens(): Promise<OneClickToken[]>
  quote(req: QuoteRequest): Promise<OneClickQuote>
  status(depositAddress: string): Promise<OneClickStatus>
  submitDeposit(d: { txHash: string; depositAddress: string; nearSenderAccount: string }): Promise<void>
}

export class OneClickError extends Error {}

export function oneClick(opts: { url?: string; jwt?: string; fetch?: typeof fetch }): OneClick {
  const base = `${(opts.url ?? ONECLICK_URL).replace(/\/$/, '')}/v0`
  const f = opts.fetch ?? fetch
  const headers = {
    'content-type': 'application/json',
    ...(opts.jwt ? { authorization: `Bearer ${opts.jwt}` } : {}),
  }
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await f(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) })
    const body = (await res.json().catch(() => ({}))) as T & { message?: string }
    if (!res.ok) throw new OneClickError(body.message ?? `1click ${res.status}`)
    return body
  }
  return {
    tokens: () => call<OneClickToken[]>('/tokens'),
    quote: (req) => call<OneClickQuote>('/quote', { method: 'POST', body: JSON.stringify(req) }),
    status: (addr) => call<OneClickStatus>(`/status?depositAddress=${encodeURIComponent(addr)}`),
    submitDeposit: async (d) => {
      await call('/deposit/submit', { method: 'POST', body: JSON.stringify(d) })
    },
  }
}

/** "10.5" in a token with `decimals` → "10500000" (its smallest unit). Undefined when it isn't a positive amount. */
export function toUnits(amount: string, decimals: number): bigint | undefined {
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(amount.trim())
  if (!m) return undefined
  const frac = m[2] ?? ''
  if (frac.length > decimals) return undefined
  const units = BigInt(m[1]! + frac.padEnd(decimals, '0'))
  return units > 0n ? units : undefined
}

type IntentRow = {
  id: string
  user_id: string
  kind: 'add_money' | 'cash_out'
  origin_asset: string
  destination_asset: string
  amount_in: string
  amount_out: string
  deposit_address: string
  deposit_memo: string
  recipient: string
  refund_to: string
  deadline: number
  status: string
  deposit_tx: string
  checked_at: number
  created_at: number
}

const view = (r: IntentRow) => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  originAsset: r.origin_asset,
  destinationAsset: r.destination_asset,
  amountIn: r.amount_in,
  amountOut: r.amount_out,
  depositAddress: r.deposit_address,
  ...(r.deposit_memo ? { depositMemo: r.deposit_memo } : {}),
  deadline: r.deadline,
  ...(r.deposit_tx ? { depositTx: r.deposit_tx } : {}),
  createdAt: r.created_at,
})

/** An open cash-out this api issued to `userId` at `depositAddress`, for the relay's check (relay.ts). */
export function openCashOut(db: Db, userId: string, depositAddress: string, now = Date.now()) {
  const r = one<IntentRow>(
    db,
    "SELECT * FROM intents WHERE user_id = ? AND kind = 'cash_out' AND deposit_address = ? ORDER BY created_at DESC",
    userId,
    depositAddress,
  )
  if (!r) return undefined
  return { amount: r.amount_in, expired: r.deadline <= now, paid: r.deposit_tx !== '' }
}

/** After the relay sent the player's deposit: remember it (never paid twice) and tell 1Click, best effort. */
export async function cashOutPaid(
  deps: { db: Db; oneclick?: OneClick },
  user: User,
  depositAddress: string,
  txHash: string,
) {
  run(
    deps.db,
    "UPDATE intents SET deposit_tx = ? WHERE user_id = ? AND kind = 'cash_out' AND deposit_address = ? AND deposit_tx = ''",
    txHash,
    user.id,
    depositAddress,
  )
  await deps.oneclick
    ?.submitDeposit({ txHash, depositAddress, nearSenderAccount: user.near_account })
    .catch((e: unknown) => console.warn('1click deposit/submit', e))
}

const Asset = z.object({ blockchain: z.string().min(1).max(20), symbol: z.string().min(1).max(20) })
const Amount = z.string().min(1).max(40)

/** Mounted under /api/me by playerRoutes, which signs the player in. */
export function intentRoutes(deps: { cfg: Config; db: Db; oneclick?: OneClick; now?: () => number }) {
  const { cfg, db } = deps
  const now = deps.now ?? Date.now
  const limited = rateLimit(10, 60_000)
  const dry = cfg.NEAR_NETWORK === 'testnet'
  // The player's USDC on NEAR as 1Click knows it: mainnet Circle USDC (testnet quotes are dry runs against mainnet ids).
  const usdcAsset = `nep141:${dry ? USDC_BY_NETWORK.mainnet : cfg.USDC_CONTRACT_ID}`
  let tokens: { at: number; list: OneClickToken[] } | undefined

  const client = () => {
    if (!deps.oneclick) throw new AppError(503, 'intents_off')
    return deps.oneclick
  }
  async function tokenList(): Promise<OneClickToken[]> {
    if (tokens && now() - tokens.at < TOKENS_TTL_MS) return tokens.list
    try {
      tokens = { at: now(), list: await client().tokens() }
    } catch (e) {
      if (e instanceof AppError) throw e
      if (tokens) return tokens.list
      throw new AppError(503, 'intents_unavailable')
    }
    return tokens.list
  }
  // Asset ids come only from 1Click's own list (never built by hand).
  async function asset(blockchain: string, symbol: string): Promise<OneClickToken> {
    const t = (await tokenList()).find(
      (x) => x.blockchain === blockchain.toLowerCase() && x.symbol.toLowerCase() === symbol.toLowerCase(),
    )
    if (!t) throw new AppError(400, 'unknown_asset')
    return t
  }
  async function usdc(): Promise<OneClickToken> {
    const t = (await tokenList()).find((x) => x.assetId === usdcAsset)
    if (!t) throw new AppError(503, 'unknown_asset')
    return t
  }
  async function quote(
    req: Omit<
      QuoteRequest,
      | 'dry'
      | 'swapType'
      | 'slippageTolerance'
      | 'depositType'
      | 'refundType'
      | 'recipientType'
      | 'deadline'
      | 'quoteWaitingTimeMs'
      | 'referral'
    >,
  ) {
    try {
      return await client().quote({
        dry,
        swapType: 'EXACT_INPUT',
        slippageTolerance: SLIPPAGE_BPS,
        depositType: 'ORIGIN_CHAIN',
        refundType: 'ORIGIN_CHAIN',
        recipientType: 'DESTINATION_CHAIN',
        deadline: new Date(now() + QUOTE_VALID_MS).toISOString(),
        quoteWaitingTimeMs: 3000,
        referral: 'nyxeron',
        ...req,
      })
    } catch (e) {
      if (e instanceof AppError) throw e
      console.warn('1click quote', e)
      throw new AppError(502, 'quote_failed')
    }
  }
  const needNear = (u: User) => {
    if (!u.near_account) throw new AppError(409, 'no_near_account')
    return u.near_account
  }
  function save(
    u: User,
    kind: IntentRow['kind'],
    q: OneClickQuote,
    r: { origin: string; dest: string; recipient: string; refundTo: string },
  ) {
    const addr = q.quote.depositAddress
    if (!addr) throw new AppError(502, 'quote_failed')
    const id = q.correlationId ?? addr
    const deadline = q.quote.deadline ? Date.parse(q.quote.deadline) : now() + QUOTE_VALID_MS
    run(
      db,
      `INSERT INTO intents (id, user_id, kind, origin_asset, destination_asset, amount_in, amount_out, deposit_address,
         deposit_memo, recipient, refund_to, deadline, status, checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_DEPOSIT', ?, ?)`,
      id,
      u.id,
      kind,
      r.origin,
      r.dest,
      q.quote.amountIn,
      q.quote.amountOut,
      addr,
      q.quote.depositMemo ?? '',
      r.recipient,
      r.refundTo,
      deadline,
      now(),
      now(),
    )
    return one<IntentRow>(db, 'SELECT * FROM intents WHERE id = ?', id)!
  }
  // Polls 1Click for a row that isn't final yet, at most every 10 s.
  async function refresh(r: IntentRow): Promise<IntentRow> {
    if (TERMINAL.has(r.status) || now() - r.checked_at < STATUS_TTL_MS || !deps.oneclick) return r
    try {
      const s = await deps.oneclick.status(r.deposit_address)
      run(db, 'UPDATE intents SET status = ?, checked_at = ? WHERE id = ?', s.status, now(), r.id)
      return { ...r, status: s.status, checked_at: now() }
    } catch {
      return r // keep the last known status; the next read tries again
    }
  }
  const amounts = (q: OneClickQuote) => ({
    amountIn: q.quote.amountIn,
    amountInFormatted: q.quote.amountInFormatted,
    amountOut: q.quote.amountOut,
    amountOutFormatted: q.quote.amountOutFormatted,
    minAmountOut: q.quote.minAmountOut,
    timeEstimate: q.quote.timeEstimate,
  })

  return new Hono<AppEnv>()
    .post(
      '/add-money',
      requireActive,
      validate('json', z.object({ from: Asset, amount: Amount, refundTo: z.string().min(2).max(100) })),
      async (c) => {
        const player = needNear(c.var.user)
        limited(c.var.user.id)
        const { from, amount, refundTo } = c.req.valid('json')
        const origin = await asset(from.blockchain, from.symbol)
        const units = toUnits(amount, origin.decimals)
        if (!units) throw new AppError(400, 'bad_amount')
        if (origin.price && Number(amount) * Number(origin.price) > ADD_MONEY_MAX_USD)
          throw new AppError(400, 'bad_amount')
        const dest = await usdc()
        // Non-custodial: the USDC lands in the player's own account; a refund goes back where it came from.
        const q = await quote({
          originAsset: origin.assetId,
          destinationAsset: dest.assetId,
          amount: units.toString(),
          recipient: player,
          refundTo,
        })
        if (dry) return c.json({ dry: true, ...amounts(q) })
        const row = save(c.var.user, 'add_money', q, {
          origin: origin.assetId,
          dest: dest.assetId,
          recipient: player,
          refundTo,
        })
        return c.json({ dry: false, intent: view(row), ...amounts(q) }, 201)
      },
    )
    .post(
      '/cash-out',
      requireActive,
      validate('json', z.object({ to: Asset.extend({ address: z.string().min(2).max(100) }), amount: Amount })),
      async (c) => {
        const player = needNear(c.var.user)
        limited(c.var.user.id)
        const { to, amount } = c.req.valid('json')
        const units = toUnits(amount, 6)
        if (!units || units < CASH_OUT_MIN || units > CASH_OUT_MAX) throw new AppError(400, 'bad_amount')
        const [origin, dest] = [await usdc(), await asset(to.blockchain, to.symbol)]
        // Refunds go back to the player's own NEAR account.
        const q = await quote({
          originAsset: origin.assetId,
          destinationAsset: dest.assetId,
          amount: units.toString(),
          recipient: to.address,
          refundTo: player,
        })
        if (dry) return c.json({ dry: true, ...amounts(q) })
        const row = save(c.var.user, 'cash_out', q, {
          origin: origin.assetId,
          dest: dest.assetId,
          recipient: to.address,
          refundTo: player,
        })
        return c.json(
          {
            dry: false,
            intent: view(row),
            ...amounts(q),
            // Exactly what the client puts in the delegate it signs, then POST /api/relay (as a drink's payment).
            payment: {
              receiverId: cfg.USDC_CONTRACT_ID,
              method: 'ft_transfer',
              args: { receiver_id: row.deposit_address, amount: row.amount_in },
              deposit: '1',
              gas: CASH_OUT_GAS,
            },
          },
          201,
        )
      },
    )
    .get('/intents', async (c) => {
      const rows = all<IntentRow>(
        db,
        'SELECT * FROM intents WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
        c.var.user.id,
      )
      const fresh = []
      for (const r of rows) fresh.push(await refresh(r))
      return c.json({ intents: fresh.map(view) })
    })
    .get('/intents/:id', validate('param', z.object({ id: z.string().min(1).max(100) })), async (c) => {
      const r = one<IntentRow>(
        db,
        'SELECT * FROM intents WHERE id = ? AND user_id = ?',
        c.req.valid('param').id,
        c.var.user.id,
      )
      if (!r) throw new AppError(404, 'no_intent')
      return c.json(view(await refresh(r)))
    })
}

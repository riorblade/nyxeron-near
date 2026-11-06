import { randomBytes, randomInt } from 'node:crypto'
import { isTokenId, MAX_MARKUP, type TokenId, tokenIds, tokens, wholesaleMicroUsdc } from '@nyxeron/game'
import { Hono } from 'hono'
import { KeyPair, type KeyPairString } from 'near-api-js'
import { z } from 'zod'
import { type AppEnv, type Identity, requireActive, requireUser, type User } from './auth.ts'
import type { Config } from './config.ts'
import { all, type Db, one, run, tx } from './db.ts'
import { AppError, validate } from './http.ts'
import type { Relayer } from './near.ts'
import type { Quotes } from './quotes.ts'

export const QUOTE_TTL_MS = 60_000
export const MAX_QTY = 20
// Gas the client attaches to ft_transfer_call. Ghoza measured 11.5 TGas burnt, working from 30 TGas (#31).
export const PAYMENT_GAS = '100000000000000'

type Party = { id: number; host_id: string; title: string; seed: number; starts_at: number; ends_at: number }
const CENT = 10_000
const roundCent = (micro: number) => Math.round(micro / CENT) * CENT

// Signs the exact quote bytes; the contract checks them with env::ed25519_verify (format locked in #22 / #31).
export function quoteSigner(secret: string) {
  const key = KeyPair.fromString(secret as KeyPairString)
  return { publicKey: key.getPublicKey().toString(), sign: (bytes: Uint8Array) => key.sign(bytes).signature }
}

const live = (p: Party, now: number) => p.starts_at <= now && now < p.ends_at

export function partyRoutes(deps: { cfg: Config; db: Db; identity: Identity; quotes: Quotes; now?: () => number }) {
  const { cfg, db, quotes } = deps
  const now = deps.now ?? Date.now
  const signer = cfg.QUOTE_KEY ? quoteSigner(cfg.QUOTE_KEY) : undefined

  const getParty = (id: number) => {
    const p = one<Party>(db, 'SELECT * FROM parties WHERE id = ?', id)
    if (!p) throw new AppError(404, 'no_party')
    return p
  }
  // Today's wholesale per stock on the menu, from the live market.
  const wholesaleNow = async () => {
    const { prices } = await quotes.latest()
    const out: Partial<Record<TokenId, number>> = {}
    for (const id of tokenIds) if (prices[id]) out[id] = wholesaleMicroUsdc(prices[id]!.usd)
    return out
  }
  const view = async (p: Party) => {
    const wholesale = await wholesaleNow()
    const host = one<Pick<User, 'name' | 'near_account'>>(
      db,
      'SELECT name, near_account FROM users WHERE id = ?',
      p.host_id,
    )
    const prices = all<{ token: TokenId; price: number }>(
      db,
      'SELECT token, price FROM party_prices WHERE party_id = ?',
      p.id,
    )
    return {
      id: p.id,
      title: p.title,
      host: { name: host?.name ?? '', nearAccount: host?.near_account ?? '' },
      seed: p.seed,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      live: live(p, now()),
      menu: prices
        .filter((m) => isTokenId(m.token) && wholesale[m.token])
        .sort((a, b) => tokenIds.indexOf(a.token) - tokenIds.indexOf(b.token)) // the game's menu order
        .map((m) => ({
          token: m.token,
          ticker: tokens[m.token].ticker,
          name: tokens[m.token].name,
          price: m.price,
          wholesale: wholesale[m.token]!,
          maxPrice: wholesale[m.token]! * MAX_MARKUP,
        })),
    }
  }
  const needNear = (u: User) => {
    if (!u.near_account) throw new AppError(409, 'no_near_account')
    return u.near_account
  }

  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .get('/', (c) => {
      const t = now()
      const rows = all<Party & { host_name: string }>(
        db,
        `SELECT p.*, u.name AS host_name FROM parties p JOIN users u ON u.id = p.host_id
         WHERE p.starts_at <= ? AND p.ends_at > ? ORDER BY p.ends_at LIMIT 50`,
        t,
        t,
      )
      return c.json({ parties: rows.map((p) => ({ id: p.id, title: p.title, host: p.host_name, endsAt: p.ends_at })) })
    })
    .post(
      '/',
      requireActive,
      validate(
        'json',
        z.object({ title: z.string().trim().min(2).max(40), minutes: z.number().int().min(5).max(60).default(10) }),
      ),
      async (c) => {
        needNear(c.var.user)
        const { title, minutes } = c.req.valid('json')
        const wholesale = await wholesaleNow()
        const t = now()
        const id = tx(db, () => {
          const p = one<{ id: number }>(
            db,
            'INSERT INTO parties (host_id, title, seed, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
            c.var.user.id,
            title,
            randomInt(2 ** 31),
            t,
            t + minutes * 60_000,
            t,
          )!
          // Every priced stock starts at 1.5× wholesale; the host changes it with PUT /prices.
          for (const [token, w] of Object.entries(wholesale))
            run(
              db,
              'INSERT INTO party_prices (party_id, token, price) VALUES (?, ?, ?)',
              p.id,
              token,
              roundCent(w * 1.5),
            )
          return p.id
        })
        return c.json(await view(getParty(id)), 201)
      },
    )
    .get('/:id', validate('param', z.object({ id: z.coerce.number().int() })), async (c) =>
      c.json(await view(getParty(c.req.valid('param').id))),
    )
    .put(
      '/:id/prices',
      requireActive,
      validate('param', z.object({ id: z.coerce.number().int() })),
      validate('json', z.object({ prices: z.record(z.string(), z.number().int().positive()) })),
      async (c) => {
        const p = getParty(c.req.valid('param').id)
        if (p.host_id !== c.var.user.id) throw new AppError(403, 'not_host')
        if (now() >= p.ends_at) throw new AppError(409, 'party_over')
        const wholesale = await wholesaleNow()
        const changes = Object.entries(c.req.valid('json').prices)
        for (const [token, price] of changes) {
          if (!isTokenId(token) || !wholesale[token]) throw new AppError(400, 'unknown_token')
          if (price < wholesale[token]!) throw new AppError(400, 'below_wholesale')
          if (price > wholesale[token]! * MAX_MARKUP) throw new AppError(400, 'above_cap')
        }
        tx(db, () => {
          for (const [token, price] of changes)
            run(
              db,
              'INSERT INTO party_prices (party_id, token, price) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET price = excluded.price',
              p.id,
              token,
              roundCent(price),
            )
        })
        return c.json(await view(p))
      },
    )
    .post(
      '/:id/quote',
      requireActive,
      validate('param', z.object({ id: z.coerce.number().int() })),
      validate('json', z.object({ token: z.string(), qty: z.number().int().min(1).max(MAX_QTY) })),
      async (c) => {
        if (!signer) throw new AppError(503, 'quotes_off')
        const buyer = needNear(c.var.user)
        const p = getParty(c.req.valid('param').id)
        const t = now()
        if (!live(p, t)) throw new AppError(409, 'party_not_live')
        const { token, qty } = c.req.valid('json')
        if (!isTokenId(token)) throw new AppError(400, 'unknown_token')
        const menu = one<{ price: number }>(
          db,
          'SELECT price FROM party_prices WHERE party_id = ? AND token = ?',
          p.id,
          token,
        )
        const wholesale = (await wholesaleNow())[token]
        if (!menu || !wholesale) throw new AppError(400, 'unknown_token')
        // The market moved since the host set the price: the contract would refuse it, so the host must reprice.
        if (menu.price < wholesale || menu.price > wholesale * MAX_MARKUP) throw new AppError(409, 'reprice_needed')
        const ceo = one<{ near_account: string }>(
          db,
          'SELECT near_account FROM users WHERE id = ?',
          p.host_id,
        )!.near_account
        if (!ceo) throw new AppError(409, 'host_has_no_near_account')

        const quote = {
          v: 2,
          contract: cfg.CONTRACT_ID, // the contract refuses a quote meant for another deploy
          id: `q_${randomBytes(16).toString('base64url')}`,
          party: String(p.id),
          buyer,
          ceo,
          token,
          qty,
          unit_price: String(menu.price),
          unit_wholesale: String(wholesale),
          expires_ms: t + QUOTE_TTL_MS,
        }
        const bytes = new TextEncoder().encode(JSON.stringify(quote))
        const sig = signer.sign(bytes)
        run(
          db,
          `INSERT INTO quotes (id, party_id, buyer_id, buyer, ceo, token, qty, unit_price, unit_wholesale, expires_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          quote.id,
          p.id,
          c.var.user.id,
          buyer,
          ceo,
          token,
          qty,
          menu.price,
          wholesale,
          quote.expires_ms,
          t,
        )
        const total = String(menu.price * qty)
        return c.json({
          quote,
          // Exactly what the client puts in the delegate it signs (then POST /api/relay).
          payment: {
            receiverId: cfg.USDC_CONTRACT_ID,
            method: 'ft_transfer_call',
            args: {
              receiver_id: cfg.CONTRACT_ID,
              amount: total,
              msg: JSON.stringify({
                quote: Buffer.from(bytes).toString('base64'),
                sig: Buffer.from(sig).toString('base64'),
              }),
            },
            deposit: '1',
            gas: PAYMENT_GAS,
          },
        })
      },
    )
}

const FAUCET_CACHE_MS = 30_000

export function configRoutes(cfg: Config, relayer?: Relayer, now = Date.now) {
  const signer = cfg.QUOTE_KEY ? quoteSigner(cfg.QUOTE_KEY) : undefined
  const faucetOn = cfg.NEAR_NETWORK === 'testnet' && cfg.DEMO_MODE && relayer && cfg.RELAYER_ACCOUNT_ID
  let cached: { at: number; balance: number | null } | undefined
  // The faucet's balance, so the web can say "faucet empty" instead of failing a tap. Cached: it's an RPC call.
  const faucetBalance = async () => {
    if (cached && now() - cached.at < FAUCET_CACHE_MS) return cached.balance
    const balance = await relayer!.ftBalance(cfg.USDC_CONTRACT_ID, cfg.RELAYER_ACCOUNT_ID!).then(
      (b) => Number(b),
      () => null,
    )
    cached = { at: now(), balance }
    return balance
  }
  return new Hono().get('/', async (c) =>
    c.json({
      network: cfg.NEAR_NETWORK,
      contractId: cfg.CONTRACT_ID,
      usdcId: cfg.USDC_CONTRACT_ID,
      quoteKey: signer?.publicKey ?? null,
      menu: tokenIds.map((id) => ({ token: id, ...tokens[id] })),
      testDollars: faucetOn ? { amount: cfg.TEST_DOLLARS, faucetBalance: await faucetBalance() } : null,
    }),
  )
}

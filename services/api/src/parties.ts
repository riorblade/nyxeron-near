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
import { chainParty, settlementView } from './settlement.ts'

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

// Testnet + DEMO_MODE: one House Party is always on, so a guest never waits for a host. Its CEO is the relayer (it
// already holds test USDC), so the margin goes back to the faucet's pocket.
export const HOUSE_ID = 'house'
export const HOUSE_MINUTES = 10
// The CEO's moves (POST /:id/moves). Happy hour is money: the quote and the menu price every drink 20 % off while
// it runs, never below wholesale. The rest is show, drawn by every guest's club.
export const MOVES = {
  happyHour: { ms: 5 * 60_000, gap: Infinity }, // once a party
  anthem: { ms: 2 * 60_000, gap: 0 },
  mcHype: { ms: 60_000, gap: 0 },
  pyro: { ms: 0, gap: 10_000 },
} as const
export type MoveKind = keyof typeof MOVES
export const HAPPY_HOUR_OFF = 0.2
const houseOn = (cfg: Config) => cfg.NEAR_NETWORK === 'testnet' && cfg.DEMO_MODE && Boolean(cfg.RELAYER_ACCOUNT_ID)

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
  // The price a guest pays now: the host's price, 20 % off in happy hour (never below wholesale).
  const happyHour = (partyId: number) =>
    Boolean(
      one(
        db,
        "SELECT 1 AS x FROM party_moves WHERE party_id = ? AND kind = 'happyHour' AND until_ms > ?",
        partyId,
        now(),
      ),
    )
  const priceNow = (price: number, wholesale: number, happy: boolean) =>
    happy ? Math.max(wholesale, roundCent(price * (1 - HAPPY_HOUR_OFF))) : price
  const movesView = (partyId: number) => {
    const t = now()
    const rows = all<{ kind: MoveKind; at_ms: number; until_ms: number }>(
      db,
      'SELECT kind, at_ms, until_ms FROM party_moves WHERE party_id = ? ORDER BY at_ms',
      partyId,
    )
    return {
      moves: rows.filter((m) => m.until_ms > t).map((m) => ({ kind: m.kind, until: m.until_ms })),
      pyroAt: rows.filter((m) => m.kind === 'pyro').at(-1)?.at_ms ?? null,
      happyHourUsed: rows.some((m) => m.kind === 'happyHour'),
    }
  }

  const view = async (p: Party) => {
    const wholesale = await wholesaleNow()
    const happy = happyHour(p.id)
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
      // The party id on chain: what owed(party) and party_pot(party) take on the contract.
      chainParty: chainParty(db, p.id),
      title: p.title,
      host: { name: host?.name ?? '', nearAccount: host?.near_account ?? '' },
      demo: p.host_id === HOUSE_ID,
      seed: p.seed,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      live: live(p, now()),
      ...movesView(p.id),
      menu: prices
        .filter((m) => isTokenId(m.token) && wholesale[m.token])
        .sort((a, b) => tokenIds.indexOf(a.token) - tokenIds.indexOf(b.token)) // the game's menu order
        .map((m) => ({
          token: m.token,
          ticker: tokens[m.token].ticker,
          name: tokens[m.token].name,
          price: priceNow(m.price, wholesale[m.token]!, happy),
          listPrice: m.price,
          wholesale: wholesale[m.token]!,
          maxPrice: wholesale[m.token]! * MAX_MARKUP,
        })),
    }
  }
  // Inserts a party and its opening prices (every priced stock at 1.5× wholesale). Call inside tx().
  const openParty = (hostId: string, title: string, minutes: number, wholesale: Partial<Record<TokenId, number>>) => {
    const t = now()
    const p = one<{ id: number }>(
      db,
      'INSERT INTO parties (host_id, title, seed, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      hostId,
      title,
      randomInt(2 ** 31),
      t,
      t + minutes * 60_000,
      t,
    )!
    for (const [token, w] of Object.entries(wholesale))
      run(db, 'INSERT INTO party_prices (party_id, token, price) VALUES (?, ?, ?)', p.id, token, roundCent(w * 1.5))
    return p.id
  }
  // Opens the next House Party when none is live. Checked and inserted in one tx, so two requests can't open two.
  const ensureHouseParty = async () => {
    if (!houseOn(cfg)) return
    const isLive = () =>
      one(db, 'SELECT 1 AS x FROM parties WHERE host_id = ? AND starts_at <= ? AND ends_at > ?', HOUSE_ID, now(), now())
    if (isLive()) return
    const wholesale = await wholesaleNow().catch(() => ({}))
    if (!Object.keys(wholesale).length) return // no market right now: try again on the next list
    tx(db, () => {
      const t = now()
      run(
        db,
        `INSERT INTO users (id, name, near_account, created_at, last_seen) VALUES (?, 'NYXERON House', ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET near_account = excluded.near_account`,
        HOUSE_ID,
        cfg.RELAYER_ACCOUNT_ID!,
        t,
        t,
      )
      if (!isLive()) openParty(HOUSE_ID, 'House Party', HOUSE_MINUTES, wholesale)
    })
  }

  const needNear = (u: User) => {
    if (!u.near_account) throw new AppError(409, 'no_near_account')
    return u.near_account
  }

  return (
    new Hono<AppEnv>()
      .use(requireUser(deps))
      .get('/', async (c) => {
        await ensureHouseParty()
        const t = now()
        const rows = all<Party & { host_name: string }>(
          db,
          `SELECT p.*, u.name AS host_name FROM parties p JOIN users u ON u.id = p.host_id
         WHERE p.starts_at <= ? AND p.ends_at > ? ORDER BY p.host_id = ? DESC, p.ends_at LIMIT 50`,
          t,
          t,
          HOUSE_ID,
        )
        return c.json({
          parties: rows.map((p) => ({
            id: p.id,
            title: p.title,
            host: p.host_name,
            endsAt: p.ends_at,
            demo: p.host_id === HOUSE_ID,
          })),
        })
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
          // The host changes the opening prices with PUT /prices.
          const id = tx(db, () => openParty(c.var.user.id, title, minutes, wholesale))
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
        '/:id/moves',
        requireActive,
        validate('param', z.object({ id: z.coerce.number().int() })),
        validate('json', z.object({ kind: z.enum(Object.keys(MOVES) as [MoveKind, ...MoveKind[]]) })),
        async (c) => {
          const p = getParty(c.req.valid('param').id)
          if (p.host_id !== c.var.user.id) throw new AppError(403, 'not_host')
          const t = now()
          if (!live(p, t)) throw new AppError(409, 'party_not_live')
          const { kind } = c.req.valid('json')
          const rule = MOVES[kind]
          tx(db, () => {
            const last = one<{ at_ms: number; until_ms: number }>(
              db,
              'SELECT at_ms, until_ms FROM party_moves WHERE party_id = ? AND kind = ? ORDER BY at_ms DESC LIMIT 1',
              p.id,
              kind,
            )
            if (last && (last.until_ms > t || t - last.at_ms < rule.gap)) throw new AppError(429, 'too_soon')
            // A move never outlasts the party.
            run(
              db,
              'INSERT INTO party_moves (party_id, kind, at_ms, until_ms) VALUES (?, ?, ?, ?)',
              p.id,
              kind,
              t,
              Math.min(p.ends_at, t + rule.ms),
            )
          })
          return c.json(await view(p))
        },
      )
      // This player's paid drinks at a party (the relay marks a quote paid), newest first.
      .get('/:id/mine', validate('param', z.object({ id: z.coerce.number().int() })), (c) => {
        const p = getParty(c.req.valid('param').id)
        const rows = all<{ token: TokenId; qty: number; unit_price: number; paid_tx: string; created_at: number }>(
          db,
          `SELECT token, qty, unit_price, paid_tx, created_at FROM quotes
           WHERE party_id = ? AND buyer_id = ? AND paid_tx <> '' ORDER BY created_at DESC`,
          p.id,
          c.var.user.id,
        )
        return c.json({
          drinks: rows.map((r) => ({
            token: r.token,
            ticker: tokens[r.token]?.ticker ?? r.token,
            qty: r.qty,
            total: r.unit_price * r.qty,
            hash: r.paid_tx,
            at: r.created_at,
          })),
        })
      })
      // Where the party's settlement is: the web's Collect shares and /proof read this.
      .get('/:id/settlement', validate('param', z.object({ id: z.coerce.number().int() })), (c) =>
        c.json(settlementView(db, getParty(c.req.valid('param').id), Boolean(cfg.OWNER_ACCOUNT_ID), now())),
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
          const unitPrice = priceNow(menu.price, wholesale, happyHour(p.id))
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
            party: chainParty(db, p.id), // unique across databases (settlement.ts)
            buyer,
            ceo,
            token,
            qty,
            unit_price: String(unitPrice),
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
            unitPrice,
            wholesale,
            quote.expires_ms,
            t,
          )
          const total = String(unitPrice * qty)
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

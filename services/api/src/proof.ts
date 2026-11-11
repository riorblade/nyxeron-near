// Public proof (no sign-in): units on NEAR against the shares behind them, and every step of a party's settlement.
// SPEC §7. Only what is public on chain anyway: no emails, no names, no balances of players.
import { type TokenId, tokenIds, tokens } from '@nyxeron/game'
import { Hono } from 'hono'
import { createPublicClient, fallback, http, parseAbi } from 'viem'
import { z } from 'zod'
import type { Config } from './config.ts'
import { all, type Db, one } from './db.ts'
import { AppError, validate } from './http.ts'
import { ROBINHOOD_RPCS } from './robinhood.ts'
import { chainParty, settlementView } from './settlement.ts'

export type ProofSource = {
  /** Units of `token` on the contract (NEP-245 `mt_supply`). */
  supply(token: TokenId): Promise<bigint>
  /** Mainnet only: the warehouse's Robinhood Chain address and its `balanceOfUI` (18 decimals) of a stock. */
  warehouse?: { address(): Promise<string>; sharesUi(token: string): Promise<bigint> }
}

const CACHE_MS = 30_000
const SHARE = 10n ** 18n
const UNIT = 10n ** 15n // 0.001 share in 18 decimals

export function proofRoutes(deps: { cfg: Config; db: Db; proof?: ProofSource; now?: () => number }) {
  const { cfg, db } = deps
  const now = deps.now ?? Date.now
  let cached: { at: number; body: Promise<unknown> } | undefined

  const build = async () => {
    const src = deps.proof
    const demo = cfg.NEAR_NETWORK === 'testnet' // testnet mints carry `demo:` proofs: no real share behind them
    const warehouse = src?.warehouse ? await src.warehouse.address().catch(() => null) : null
    const rows = await Promise.all(
      tokenIds.map(async (id) => {
        const units = src ? await src.supply(id).catch(() => null) : null
        const sharesUi =
          warehouse && src?.warehouse ? await src.warehouse.sharesUi(tokens[id].address).catch(() => null) : null
        return {
          token: id,
          ticker: tokens[id].ticker,
          address: tokens[id].address,
          units: units?.toString() ?? null,
          // What the units stand for, and what the warehouse holds, both in shares (decimal strings).
          sharesOwed: units === null ? null : shares(units * UNIT),
          sharesHeld: sharesUi === null ? null : shares(sharesUi),
          backed: units === null || sharesUi === null ? null : sharesUi >= units * UNIT,
        }
      }),
    )
    const recent = all<{ id: number; title: string; ends_at: number; status: string }>(
      db,
      `SELECT p.id, p.title, p.ends_at, s.status FROM settlements s JOIN parties p ON p.id = s.party_id
       ORDER BY p.ends_at DESC LIMIT 10`,
    ).map((p) => ({ chainParty: chainParty(db, p.id), title: p.title, endsAt: p.ends_at, status: p.status }))
    return {
      network: cfg.NEAR_NETWORK,
      contractId: cfg.CONTRACT_ID,
      demo,
      warehouse,
      tokens: rows.filter((r) => r.units !== null && r.units !== '0'),
      recent,
      at: now(),
    }
  }

  return new Hono()
    .get('/', async (c) => {
      if (!cached || now() - cached.at > CACHE_MS) cached = { at: now(), body: build() }
      try {
        return c.json(await cached.body)
      } catch {
        cached = undefined
        throw new AppError(503, 'proof_unavailable')
      }
    })
    .get('/parties/:chainParty', validate('param', z.object({ chainParty: z.string().max(40) })), (c) => {
      // `<install>-<id>`: only this database's parties.
      const m = /^([0-9a-f]+)-(\d+)$/.exec(c.req.valid('param').chainParty)
      const party =
        m &&
        one<{ id: number; title: string; ends_at: number }>(
          db,
          'SELECT id, title, ends_at FROM parties WHERE id = ?',
          Number(m[2]),
        )
      if (!party || chainParty(db, party.id) !== m![0]) throw new AppError(404, 'no_party')
      const proofs = all<{ payload: string; seq: number }>(
        db,
        "SELECT payload, seq FROM chain_ops WHERE party_id = ? AND kind = 'mint' ORDER BY seq",
        party.id,
      ).map((o) => (JSON.parse(o.payload) as { proof?: string }).proof ?? null)
      const view = settlementView(db, party, Boolean(cfg.OWNER_ACCOUNT_ID), now())
      let mint = 0
      return c.json({
        chainParty: m![0],
        title: party.title,
        endsAt: party.ends_at,
        status: view.status,
        steps: view.ops.map((op) => (op.kind === 'mint' ? { ...op, proof: proofs[mint++] ?? null } : op)),
      })
    })
}

/** 18-decimal amount → a decimal string of shares, trailing zeros dropped ("0.003"). */
export function shares(v: bigint): string {
  const whole = v / SHARE
  const frac = (v % SHARE).toString().padStart(18, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : `${whole}`
}

/** A stock's `balanceOfUI` (shares, 18 decimals) of `owner` on Robinhood Chain. */
export function hoodShares(owner: () => Promise<string>) {
  const client = createPublicClient({
    transport: fallback(ROBINHOOD_RPCS.map((url) => http(url, { timeout: 15_000 }))),
  })
  const abi = parseAbi(['function balanceOfUI(address) view returns (uint256)'])
  return async (token: string) =>
    client.readContract({
      address: token as `0x${string}`,
      abi,
      functionName: 'balanceOfUI',
      args: [(await owner()) as `0x${string}`],
    })
}

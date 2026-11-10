// The end of a party (SPEC §5.3): release its wholesale, back the units guests are owed in the warehouse, and settle
// them to the guests. Every step is a row in the `chain_ops` outbox, run one transaction at a time, retried with
// backoff, and checked on chain before it is sent, so a crash or a lost answer never mints or settles twice (the
// contract refuses a reused proof or op id too).
import type { Config } from './config.ts'
import { all, type Db, one, run, tx } from './db.ts'

// The contract's limits (contracts/nyxeron/src/lib.rs): transfers per settle, op id and proof lengths.
export const MAX_SETTLE_TRANSFERS = 32
export const MAX_KEY_LEN = 64
export const MAX_PROOF_LEN = 128
export const MAX_ATTEMPTS = 5
// Quotes stay valid 60 s after they're signed, and parties only sign while live: wait that out before closing a party.
export const GRACE_MS = 90_000
// A step being sent is leased this long: no other tick or process takes it before. After a crash it runs again (its
// on-chain check comes first), so the lease only has to outlast one send: a mainnet buy is two MPC signatures + a swap.
export const LEASE_MS = 10 * 60_000
const BACKOFF_MS = 15_000
const MAX_BACKOFF_MS = 10 * 60_000

export type Owed = { account_id: string; token_id: string; qty: string }
export type Transfer = { account_id: string; token_id: string; amount: string }
export type OpKind = 'release' | 'mint' | 'settle'
export type OpStatus = 'pending' | 'sent' | 'done' | 'failed'
type MintPayload = { token: string; units: string; proof?: string }
type SettlePayload = { transfers: Transfer[] }
export type OpSpec = { id: string; seq: number; kind: OpKind; payload: object }
export type OpRow = {
  id: string
  party_id: number
  seq: number
  kind: OpKind
  payload: string
  status: OpStatus
  attempts: number
  next_at: number
  tx_hash: string
  error: string
  updated_at: number
}

// What settlement needs on NEAR, signed with the contract owner's key. A fake in tests.
export type SettleChain = {
  release(party: string): Promise<string>
  mint(token: string, units: bigint, proof: string): Promise<string>
  settle(party: string, opId: string, transfers: Transfer[]): Promise<string>
  owed(party: string): Promise<Owed[]>
  pot(party: string): Promise<{ held: string; released: boolean }>
  isUsedProof(proof: string): Promise<boolean>
  isSettled(opId: string): Promise<boolean>
}

// Gets the real shares for `units` of `token` and returns the proof for mint_warehouse.
export type BuyShares = (party: string, token: string, units: bigint) => Promise<string>

// A step that can't succeed by retrying (stops the party at once).
export class SettlementError extends Error {
  readonly code: string
  readonly permanent: boolean
  // A wait, not a failure (the day's cap, the warehouse being topped up): try again at this time, and don't count it
  // against MAX_ATTEMPTS.
  readonly retryAt?: number
  constructor(code: string, permanent = false, retryAt?: number) {
    super(code)
    this.code = code
    this.permanent = permanent
    this.retryAt = retryAt
  }
}

const installs = new WeakMap<Db, string>()
/** The party id the contract sees (and the signed quotes carry): `<install>-<id>`, unique across databases. */
export function chainParty(db: Db, partyId: number): string {
  let install = installs.get(db)
  if (!install) {
    install = one<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'install'")!.value
    installs.set(db, install)
  }
  return `${install}-${partyId}`
}

/** Testnet (SPEC §10): the purchase is simulated, and the proof says so. Mainnet: the warehouse's real swap (swap.ts),
 * or `not_built` when the api has no warehouse account. */
export function buySharesFor(cfg: Config, mainnet?: BuyShares): BuyShares {
  return async (party, token, units) => {
    if (cfg.NEAR_NETWORK === 'testnet') return `demo:${party}:${token}:1`
    if (!mainnet) throw new SettlementError('not_built', true)
    return mainnet(party, token, units)
  }
}

/** The ops after the release, from the owed snapshot (frozen once the party is released): one mint per token for the
 * total owed, then the transfers sorted and cut into batches of at most 32. */
export function planOps(party: string, owed: Owed[]): OpSpec[] {
  const units = new Map<string, bigint>()
  for (const o of owed) units.set(o.token_id, (units.get(o.token_id) ?? 0n) + BigInt(o.qty))
  const mints: OpSpec[] = [...units.entries()]
    .filter(([, u]) => u > 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([token, u], i) => ({
      id: `mint:${party}:${token}`,
      seq: i + 1,
      kind: 'mint',
      payload: { token, units: u.toString() } satisfies MintPayload,
    }))
  const transfers: Transfer[] = owed
    .filter((o) => BigInt(o.qty) > 0n)
    .map((o) => ({ account_id: o.account_id, token_id: o.token_id, amount: o.qty }))
    .sort((a, b) => a.account_id.localeCompare(b.account_id) || a.token_id.localeCompare(b.token_id))
  const settles: OpSpec[] = []
  for (let i = 0; i < transfers.length; i += MAX_SETTLE_TRANSFERS) {
    const batch = settles.length + 1
    settles.push({
      id: `party:${party}:${batch}`,
      seq: mints.length + batch,
      kind: 'settle',
      payload: { transfers: transfers.slice(i, i + MAX_SETTLE_TRANSFERS) } satisfies SettlePayload,
    })
  }
  for (const op of settles) if (op.id.length > MAX_KEY_LEN) throw new SettlementError('op_id_too_long', true)
  return [...mints, ...settles]
}

export type Next = { kind: 'run'; op: OpRow } | { kind: 'wait' } | { kind: 'done' } | { kind: 'failed'; op: OpRow }

/** What to do with a party's ops: stop at a failed one, run the first unfinished one when it's due, else wait. */
export function nextOp(ops: OpRow[], now: number): Next {
  const sorted = [...ops].sort((a, b) => a.seq - b.seq)
  const failed = sorted.find((o) => o.status === 'failed')
  if (failed) return { kind: 'failed', op: failed }
  const open = sorted.find((o) => o.status !== 'done')
  if (!open) return { kind: 'done' }
  return open.next_at <= now ? { kind: 'run', op: open } : { kind: 'wait' }
}

export const backoff = (attempts: number) => Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** Math.max(0, attempts - 1))

type PartyRow = { id: number; ends_at: number }

export function settlement(deps: {
  db: Db
  chain: SettleChain
  buyShares: BuyShares
  now?: () => number
  log?: (msg: string) => void
}) {
  const { db, chain } = deps
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  let running = false

  const opsOf = (partyId: number) => all<OpRow>(db, 'SELECT * FROM chain_ops WHERE party_id = ? ORDER BY seq', partyId)
  const setParty = (partyId: number, status: 'pending' | 'done' | 'failed', error = '') =>
    run(
      db,
      `INSERT INTO settlements (party_id, status, error, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (party_id) DO UPDATE SET status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`,
      partyId,
      status,
      error,
      now(),
    )
  const insertOps = (partyId: number, specs: OpSpec[]) =>
    tx(db, () => {
      for (const s of specs)
        run(
          db,
          `INSERT INTO chain_ops (id, party_id, seq, kind, payload, status, next_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
          s.id,
          partyId,
          s.seq,
          s.kind,
          JSON.stringify(s.payload),
          now(),
          now(),
        )
    })

  // Already on chain? Asked before every send, so a resumed or retried op never lands twice.
  async function landed(op: OpRow): Promise<boolean> {
    const party = chainParty(db, op.party_id)
    if (op.kind === 'release') {
      const pot = await chain.pot(party)
      return pot.released && BigInt(pot.held) === 0n
    }
    if (op.kind === 'mint') {
      const p = JSON.parse(op.payload) as MintPayload
      return p.proof !== undefined && (await chain.isUsedProof(p.proof))
    }
    return chain.isSettled(op.id)
  }

  async function send(op: OpRow): Promise<string> {
    const party = chainParty(db, op.party_id)
    if (op.kind === 'release') {
      const hash = await chain.release(party)
      // A release whose USDC transfer bounced still "succeeds" (the contract puts the pot back): check, don't trust it.
      if (!(await landed(op))) throw new SettlementError('release_not_landed')
      return hash
    }
    if (op.kind === 'mint') {
      const p = JSON.parse(op.payload) as MintPayload
      if (p.proof === undefined) {
        // Buy first and keep the proof before minting: a crash between the two must not buy twice.
        p.proof = await deps.buyShares(party, p.token, BigInt(p.units))
        if (p.proof.length > MAX_PROOF_LEN) throw new SettlementError('proof_too_long', true)
        run(db, 'UPDATE chain_ops SET payload = ? WHERE id = ?', JSON.stringify(p), op.id)
      }
      return chain.mint(p.token, BigInt(p.units), p.proof)
    }
    return chain.settle(party, op.id, (JSON.parse(op.payload) as SettlePayload).transfers)
  }

  async function execute(op: OpRow) {
    const attempts = op.attempts + 1
    run(
      db,
      "UPDATE chain_ops SET status = 'sent', attempts = ?, next_at = ?, updated_at = ? WHERE id = ?",
      attempts,
      now() + LEASE_MS,
      now(),
      op.id,
    )
    try {
      const hash = (await landed(op)) ? op.tx_hash || 'on-chain' : await send(op)
      run(
        db,
        "UPDATE chain_ops SET status = 'done', tx_hash = ?, error = '', updated_at = ? WHERE id = ?",
        hash,
        now(),
        op.id,
      )
      log(`settlement: ${op.id} done ${hash}`)
    } catch (e) {
      const code = e instanceof SettlementError ? e.code : String((e as Error)?.message ?? e).slice(0, 300)
      const wait = e instanceof SettlementError && !e.permanent ? e.retryAt : undefined
      const final = wait === undefined && ((e instanceof SettlementError && e.permanent) || attempts >= MAX_ATTEMPTS)
      run(
        db,
        'UPDATE chain_ops SET status = ?, attempts = ?, error = ?, next_at = ?, updated_at = ? WHERE id = ?',
        final ? 'failed' : 'pending',
        wait === undefined ? attempts : op.attempts,
        code,
        wait ?? now() + backoff(attempts),
        now(),
        op.id,
      )
      if (final) setParty(op.party_id, 'failed', `${op.id}: ${code}`)
      log(`settlement: ${op.id} ${final ? 'failed' : 'will retry'}: ${code}`)
    }
  }

  // Moves one party one step. Returns true when it sent (or tried to send) a transaction.
  async function step(p: PartyRow): Promise<boolean> {
    let ops = opsOf(p.id)
    const party = chainParty(db, p.id)
    if (!ops.length) {
      // No drink sold: the contract has no pot to release and nobody is owed anything.
      const pot = await chain.pot(party)
      if (!pot.released && BigInt(pot.held) === 0n) {
        setParty(p.id, 'done')
        return false
      }
      setParty(p.id, 'pending')
      insertOps(p.id, [{ id: `release:${p.id}`, seq: 0, kind: 'release', payload: {} }])
      ops = opsOf(p.id)
    }
    // Released and nothing planned after it yet: plan from what the contract says each guest is owed.
    if (ops.length === 1 && ops[0]!.kind === 'release' && ops[0]!.status === 'done') {
      const specs = planOps(party, await chain.owed(party))
      if (!specs.length) {
        setParty(p.id, 'done')
        return false
      }
      insertOps(p.id, specs)
      ops = opsOf(p.id)
    }
    const next = nextOp(ops, now())
    if (next.kind === 'done') setParty(p.id, 'done')
    if (next.kind !== 'run') return false
    await execute(next.op)
    return true
  }

  /** One transaction at most per call, for the first ended party that has work. Safe to call on a timer. */
  async function tick(): Promise<void> {
    if (running) return
    running = true
    try {
      const parties = all<PartyRow>(
        db,
        `SELECT p.id, p.ends_at FROM parties p LEFT JOIN settlements s ON s.party_id = p.id
         WHERE p.ends_at + ? <= ? AND (s.status IS NULL OR s.status = 'pending') ORDER BY p.ends_at`,
        GRACE_MS,
        now(),
      )
      for (const p of parties) if (await step(p)) return
    } finally {
      running = false
    }
  }

  return { tick }
}

/** An admin retry: the failed op runs again (its on-chain check comes first), and the party resumes. */
export function retryOp(db: Db, opId: string, now = Date.now()): boolean {
  const op = one<OpRow>(db, "SELECT * FROM chain_ops WHERE id = ? AND status = 'failed'", opId)
  if (!op) return false
  tx(db, () => {
    run(
      db,
      "UPDATE chain_ops SET status = 'pending', attempts = 0, next_at = ?, updated_at = ? WHERE id = ?",
      now,
      now,
      opId,
    )
    run(
      db,
      "UPDATE settlements SET status = 'pending', error = '', updated_at = ? WHERE party_id = ?",
      now,
      op.party_id,
    )
  })
  return true
}

export type SettlementView = {
  status: 'off' | 'live' | 'waiting' | 'pending' | 'done' | 'failed'
  ops: { kind: OpKind; token?: string; units?: string; hash?: string; status: OpStatus }[]
}

/** For the web's Collect shares and /proof: where a party's settlement is, with every step's tx hash. */
export function settlementView(db: Db, party: PartyRow, on: boolean, now = Date.now()): SettlementView {
  const row = one<{ status: 'pending' | 'done' | 'failed' }>(
    db,
    'SELECT status FROM settlements WHERE party_id = ?',
    party.id,
  )
  const ops = all<OpRow>(db, 'SELECT * FROM chain_ops WHERE party_id = ? ORDER BY seq', party.id).map((o) => {
    const p = JSON.parse(o.payload) as Partial<MintPayload & SettlePayload>
    const units =
      o.kind === 'mint'
        ? p.units
        : o.kind === 'settle'
          ? (p.transfers ?? []).reduce((a, t) => a + BigInt(t.amount), 0n).toString()
          : undefined
    return {
      kind: o.kind,
      ...(o.kind === 'mint' ? { token: p.token } : {}),
      ...(units !== undefined ? { units } : {}),
      ...(o.tx_hash ? { hash: o.tx_hash } : {}),
      status: o.status,
    }
  })
  const status = row ? row.status : now < party.ends_at ? 'live' : on ? 'waiting' : 'off'
  return { status, ops }
}

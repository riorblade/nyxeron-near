// The player's stock units on NEAR (NEP-245 on our contract), their dollars, and "Collect shares": per party they bought
// at, what is still owed to them (owed(party) on chain) and where the delivery is (the api's settlement job).
import './portfolio.css'
import { tokens } from '@nyxeron/game'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { audio } from '../audio/music.ts'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { explorer, nearProvider, view } from '../near/chain.ts'
import { Link } from '../router.tsx'
import { type Owed, owedTo, shares, unitsByToken } from './holdings.ts'
import { type Settlement, settleHash, settlementNote } from './settlement.ts'
import { visitedParties } from './visited.ts'
import { StockLogo } from '../stock/StockLogo.tsx'

// The parties a player is shown at most (newest first): each one costs an api call and a chain read.
const MAX_PARTIES = 10

type PartyShares = {
  id: number
  title: string
  owed: Record<string, number> // token → units still owed to this player
  settlement?: Settlement
}

type State = {
  units: Record<string, number>
  parties: PartyShares[]
  owedReady: boolean // false while the deployed contract has no owed() yet
}

const ticker = (id: string) => tokens[id as keyof typeof tokens]?.ticker ?? id.toUpperCase()
const TONE = { muted: 'text-muted', ink: 'text-ink', up: 'text-up', down: 'text-down' }
// Where a delivery is, as the three lamps on its ticket: party over, shares bought, home.
const STAGE: Record<Settlement['status'], number> = { off: 0, live: 0, waiting: 1, pending: 2, done: 3, failed: 2 }
// Empty slots keep the collection looking like an inventory to fill, even with one stock in it.
const MIN_SLOTS = 4
const SEEN_KEY = 'nyxeron.home.v1'

function seenDeliveries(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is number => Number.isInteger(x)) : []
  } catch {
    return []
  }
}

function markSeen(ids: number[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...ids, ...seenDeliveries()])].slice(0, 100)))
  } catch {
    // Storage unavailable: the moment may show again next visit, which is harmless.
  }
}

type Moment = { title: string; units: [string, number][] }

export function Portfolio({ account }: { account: Account }) {
  const [state, setState] = useState<State>()
  const [error, setError] = useState<string>()
  const { config, address, api } = account

  const load = useCallback(async () => {
    if (!config || !address) return
    const provider = nearProvider(config.network)
    try {
      const registry = (await view<[string, unknown][]>(provider, config.contractId, 'tokens')) ?? []
      const ids = registry.map(([id]) => id)
      const balances = ids.length
        ? await view<string[]>(provider, config.contractId, 'mt_batch_balance_of', {
            account_id: address,
            token_ids: ids,
          })
        : []
      let owedReady = true
      const parties: PartyShares[] = []
      for (const id of visitedParties().slice(0, MAX_PARTIES)) {
        const r = await api.parties[':id'].$get({ param: { id: String(id) } })
        if (!r.ok) continue
        const party = await r.json()
        const rows = await view<Owed[]>(provider, config.contractId, 'owed', { party: party.chainParty })
        if (rows === undefined) owedReady = false
        const s = await api.parties[':id'].settlement.$get({ param: { id: String(id) } })
        parties.push({
          id,
          title: party.title,
          owed: owedTo(address, { [id]: rows })[id] ?? {},
          settlement: s.ok ? await s.json() : undefined,
        })
      }
      setState({ units: unitsByToken(ids, balances), parties, owedReady })
      setError(undefined)
    } catch {
      setError("Couldn't read your shares right now.")
    }
  }, [config, address, api])

  // Read again every 20 s while a delivery is still moving, so "Collect shares" turns into shares without a reload.
  const moving = state?.parties.some((p) => ['live', 'waiting', 'pending'].includes(p.settlement?.status ?? ''))
  useEffect(() => {
    void load()
    if (!moving) return
    const id = setInterval(() => void load(), 20_000)
    return () => clearInterval(id)
  }, [load, moving])

  // What each party still owed this player, kept from earlier reads: once delivered, owed() on chain is back to zero.
  const owedSeen = useRef<Record<number, Record<string, number>>>({})
  const [moment, setMoment] = useState<Moment>()
  useEffect(() => {
    if (!state) return
    for (const p of state.parties) if (Object.keys(p.owed).length) owedSeen.current[p.id] = p.owed
    const seen = seenDeliveries()
    const fresh = state.parties.filter(
      (p) => p.settlement?.status === 'done' && settleHash(p.settlement) && !seen.includes(p.id),
    )
    if (!fresh.length) return
    // The shares that came home: what we saw owed, else what the player now holds of the stocks the party bought.
    const sum: Record<string, number> = {}
    for (const p of fresh) {
      const owed = owedSeen.current[p.id]
      for (const [id, units] of Object.entries(owed ?? {})) sum[id] = (sum[id] ?? 0) + units
    }
    for (const p of fresh.filter((p) => !owedSeen.current[p.id])) {
      for (const o of p.settlement?.ops ?? []) {
        const held = o.kind === 'mint' && o.token ? state.units[o.token] : undefined
        if (held) sum[o.token!] = Math.max(sum[o.token!] ?? 0, held)
      }
    }
    const units = Object.entries(sum)
    if (!units.length) return
    markSeen(fresh.map((p) => p.id))
    setMoment({
      title: fresh.length === 1 ? fresh[0]!.title : `${fresh.length} parties`,
      units,
    })
  }, [state])

  const held = Object.entries(state?.units ?? {})
  const empty = Math.max(0, MIN_SLOTS - held.length, held.length % 2)
  return (
    <section className="pf">
      <header className="pf-head">
        <h2 className="pf-title">Your portfolio</h2>
        {state && config && address && (
          <a
            className="pf-chain"
            href={`${explorer(config.network)}/address/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            See it on chain ↗
          </a>
        )}
      </header>
      <div className="pf-cash">
        <span className="pf-label">Dollars</span>
        <b className="pf-money">{account.balance === undefined ? '…' : usd(account.balance)}</b>
      </div>
      {error && <p className="mt-3 text-sm text-down">{error}</p>}
      {!state && !error && <p className="mt-3 text-sm text-muted">Reading your shares…</p>}
      {state && (
        <>
          <h3 className="pf-label pf-sub">
            Shares you hold
            {held.length > 0 && (
              <span>
                {held.length} stock{held.length === 1 ? '' : 's'}
              </span>
            )}
          </h3>
          <ul className="pf-cards">
            {held.map(([id, units]) => (
              <li key={id} className="pf-card">
                <StockLogo id={id} size={40} />
                <b className="pf-tick">{ticker(id)}</b>
                <span className="pf-shares">
                  {shares(units)} <small>share</small>
                </span>
                <span className="pf-drinks">
                  {units} drink{units === 1 ? '' : 's'}
                </span>
              </li>
            ))}
            {Array.from({ length: empty }, (_, i) => (
              <li key={`slot-${i}`} className="pf-card is-empty" aria-hidden />
            ))}
          </ul>
          {held.length === 0 && <p className="pf-note">None yet. Buy drinks at a party and collect them after.</p>}
          <h3 className="pf-label pf-sub">Collect shares</h3>
          {!state.owedReady ? (
            <p className="pf-note">Shares from parties show here once the new contract is live.</p>
          ) : state.parties.length === 0 ? (
            <p className="pf-note">Nothing waiting. Shares from a party arrive after it ends.</p>
          ) : (
            <ul className="pf-tickets">
              {state.parties.map((p) => (
                <CollectRow key={p.id} party={p} explorerUrl={config ? explorer(config.network) : ''} />
              ))}
            </ul>
          )}
        </>
      )}
      {moment && createPortal(<SharesHome moment={moment} onClose={() => setMoment(undefined)} />, document.body)}
    </section>
  )
}

function CollectRow({ party, explorerUrl }: { party: PartyShares; explorerUrl: string }) {
  const owed = Object.entries(party.owed)
  const status = party.settlement?.status
  const note = status ? settlementNote(status) : undefined
  const hash = party.settlement ? settleHash(party.settlement) : undefined
  const stage = status ? STAGE[status] : 0
  return (
    <li className={`pf-ticket${status === 'done' ? ' is-home' : ''}${status === 'failed' ? ' is-late' : ''}`}>
      <Link href={`/city/party/${party.id}`} className="pf-party">
        {party.title}
      </Link>
      {owed.length > 0 && (
        <ul className="pf-owed">
          {owed.map(([id, units]) => (
            <li key={id}>
              <StockLogo id={id} size={20} />
              {shares(units)} {ticker(id)}
            </li>
          ))}
        </ul>
      )}
      {status && (
        <ol className="pf-lamps" aria-hidden>
          {['Party over', 'Bought', 'Home'].map((s, i) => (
            <li key={s} className={i < stage ? 'is-lit' : ''}>
              {s}
            </li>
          ))}
        </ol>
      )}
      {note && <div className={`text-xs ${TONE[note.tone]}`}>{note.text}</div>}
      {hash && (
        <a className="pf-receipt" href={`${explorerUrl}/txns/${hash}`} target="_blank" rel="noreferrer">
          delivery receipt ↗
        </a>
      )}
    </li>
  )
}

/** The reward screen for a delivery: the stocks in the middle, the shares counting up, once per party. */
function SharesHome({ moment, onClose }: { moment: Moment; onClose: () => void }) {
  const go = useRef<HTMLButtonElement>(null)
  const [t, setT] = useState(0)

  useEffect(() => {
    go.current?.focus()
    audio.cash()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setT(1)
    const start = performance.now() + 450
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 1100))
      setT(1 - (1 - k) ** 3)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pf-moment" role="dialog" aria-modal="true" aria-labelledby="pf-moment-title" onClick={onClose}>
      <img className="pf-m-crowd" src="/landing/intro.webp" alt="" aria-hidden />
      <p className="pf-m-tag">Delivered from {moment.title}</p>
      <h2 id="pf-moment-title" className="pf-m-sign">
        Your shares are home
      </h2>
      <ul className="pf-m-stocks">
        {moment.units.map(([id, units], i) => (
          <li key={id} style={{ animationDelay: `${0.25 + i * 0.12}s` }}>
            <StockLogo id={id} size={96} />
            <b>{ticker(id)}</b>
            <span className="pf-m-count">+{shares(units * t)}</span>
            <small>share</small>
          </li>
        ))}
      </ul>
      <button ref={go} className="pf-m-go" onClick={onClose}>
        Nice <span aria-hidden>↵</span>
      </button>
    </div>
  )
}

// One City party as a guest: the bar's drinks as cards, buy one in a tap. The drink shows up on the tab at once and is
// marked done when the relay confirms it; a refusal explains itself.
import './party.css'
import { tokens } from '@nyxeron/game'
import type { InferResponseType } from 'hono/client'
import { useCallback, useEffect, useState } from 'react'
import { audio } from '../audio/music.ts'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { explorer, nearProvider } from '../near/chain.ts'
import { Link } from '../router.tsx'
import { buyDrink } from './buy.ts'
import { ClubBackdrop } from './ClubBackdrop.tsx'
import { PlayerError, playerMessage } from './errors.ts'
import { HostMoves } from './HostMoves.tsx'
import { HostPrices } from './HostPrices.tsx'
import { type Settlement, settleHash, settlementNote, stepLabel } from './settlement.ts'
import { rememberParty } from './visited.ts'
import { StockLogo } from '../stock/StockLogo.tsx'

// The club behind a City party: the top room, the superclub with its pool deck (Practice is where you climb the levels;
// a real party gets the full room). The api doesn't carry a host's venue level.
const CLUB_LEVEL = 4

type Party = InferResponseType<Account['api']['parties'][':id']['$get'], 200>
type MenuRow = Party['menu'][number]
type Drink = {
  key: number
  ticker: string
  qty: number
  total: number
  state: 'pending' | 'done' | 'failed'
  note?: string
}

export function PartyView({ account, partyId }: { account: Account; partyId: number }) {
  const [party, setParty] = useState<Party>()
  const [error, setError] = useState<string>()
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [busy, setBusy] = useState<string>()
  const [walking, setWalking] = useState(false)
  const [settlement, setSettlement] = useState<Settlement>()
  // The last confirmed buy, for the card's short reward animation.
  const [won, setWon] = useState<{ key: number; token: string; ticker: string; qty: number }>()

  const load = useCallback(async () => {
    const r = await account.api.parties[':id'].$get({ param: { id: String(partyId) } })
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      return setError(playerMessage(body.error ?? 'unknown'))
    }
    const p = await r.json()
    setParty(p)
    if (p.live) return
    const s = await account.api.parties[':id'].settlement.$get({ param: { id: String(partyId) } })
    if (s.ok) setSettlement(await s.json())
  }, [account.api, partyId])

  // What this player already bought here (paid on chain), so Your drinks survives a reload.
  useEffect(() => {
    void (async () => {
      const r = await account.api.parties[':id'].mine.$get({ param: { id: String(partyId) } })
      if (!r.ok) return
      const { drinks: paid } = await r.json()
      setDrinks((d) =>
        d.length
          ? d
          : paid.map((x, i) => ({
              key: -1 - i,
              ticker: x.ticker,
              qty: x.qty,
              total: x.total,
              state: 'done' as const,
              note: x.hash,
            })),
      )
    })()
  }, [account.api, partyId])

  useEffect(() => {
    void load()
    // Often enough that every guest sees the host's moves (happy hour, pyro) within a few seconds.
    const id = setInterval(load, 5_000)
    return () => clearInterval(id)
  }, [load])

  const buy = async (row: MenuRow, qty: number) => {
    if (!account.canPay || !account.config || !account.address || !account.sign) return
    const key = Date.now()
    setBusy(row.token)
    setDrinks((d) => [{ key, ticker: row.ticker, qty, total: row.price * qty, state: 'pending' }, ...d])
    const settle = (patch: Partial<Drink>) => setDrinks((d) => d.map((x) => (x.key === key ? { ...x, ...patch } : x)))
    try {
      const bought = await buyDrink(
        {
          api: {
            quote: (id, body) =>
              account.api.parties[':id'].quote.$post({ param: { id: String(id) }, json: body }) as Promise<Response>,
            relay: (body) => account.api.relay.$post({ json: body }) as Promise<Response>,
          },
          provider: nearProvider(account.config.network),
          sender: account.address,
          sign: account.sign,
        },
        partyId,
        row.token,
        qty,
      )
      settle({ state: 'done', note: bought.hash, total: bought.total })
      setWon({ key, token: row.token, ticker: row.ticker, qty })
      audio.cash()
      rememberParty(partyId)
      void account.refreshBalance()
    } catch (e) {
      settle({ state: 'failed', note: e instanceof PlayerError ? e.message : playerMessage('unknown') })
    } finally {
      setBusy(undefined)
    }
  }

  if (error)
    return (
      <section className="pv-note">
        <p className="text-down">{error}</p>
        <Link href="/city" className="pv-back">
          ← All parties
        </Link>
      </section>
    )
  if (!party) return <p className="pv-loading">Loading the party…</p>

  const isHost = Boolean(account.address && party.host.nearAccount === account.address)
  const happy = party.live ? party.moves.find((m) => m.kind === 'happyHour') : undefined
  const paid = drinks.filter((d) => d.state === 'done')
  const owned = (ticker: string) => paid.filter((d) => d.ticker === ticker).reduce((n, d) => n + d.qty, 0)
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { timeStyle: 'short' })
  return (
    <div className="pv">
      <ClubBackdrop
        level={CLUB_LEVEL}
        moves={party.live ? party.moves.map((m) => m.kind) : []}
        pyroAt={party.pyroAt}
        walk={walking ? { name: account.profile?.name || 'Guest', onExit: () => setWalking(false) } : undefined}
      />
      {isHost && party.live && !walking && (
        <div className="pv-wide">
          <HostPrices
            account={account}
            partyId={partyId}
            menu={party.menu.map((m) => ({ ...m, price: m.listPrice }))}
            onSaved={() => void load()}
          />
        </div>
      )}
      {isHost && party.live && !walking && (
        <div className="pv-wide">
          <HostMoves
            account={account}
            partyId={partyId}
            active={party.moves.map((m) => m.kind)}
            happyHourUsed={party.happyHourUsed}
            onDone={() => void load()}
          />
        </div>
      )}
      <section className="pv-main" hidden={walking}>
        <header className="pv-head">
          <Link href="/city" className="pv-back">
            ← All parties
          </Link>
          <div className="pv-marquee">
            <span className={party.live ? 'pv-open' : 'pv-shut'}>{party.live ? 'Open' : 'Closed'}</span>
            <h2 className="pv-title">{party.title}</h2>
          </div>
          <p className="pv-host">
            {isHost ? 'Your party' : `Hosted by ${party.host.name || 'a host'}`} ·{' '}
            {party.live ? `until ${time(party.endsAt)}` : 'not open'}
          </p>
          {happy && (
            <p className="pv-happy">
              <b>Happy hour</b> 20% off every drink until {time(happy.until)}
            </p>
          )}
        </header>
        <ul className="pv-bar" aria-label="The bar">
          {party.menu.map((row) => {
            const count = owned(row.ticker)
            const pouring = busy === row.token
            const reward = won?.token === row.token ? won : undefined
            return (
              <li key={row.token} className={`pv-drink${pouring ? ' is-pouring' : ''}${reward ? ' is-won' : ''}`}>
                <div className="pv-face">
                  <StockLogo id={row.token} size={44} />
                  <div className="pv-id">
                    <div className="pv-ticker">{row.ticker}</div>
                    <div className="pv-name">{tokens[row.token as keyof typeof tokens]?.name ?? row.name}</div>
                  </div>
                  {count > 0 && (
                    <span key={count} className="pv-count" aria-label={`${count} bought here`}>
                      ×{count}
                    </span>
                  )}
                </div>
                <div className="pv-price">
                  <b>{pouring ? 'Pouring…' : usd(row.price)}</b>
                  {row.price < row.listPrice && <s>{usd(row.listPrice)}</s>}
                </div>
                <div className="pv-share">0.001 share</div>
                <div className="pv-buy">
                  {[1, 3].map((qty) => (
                    <button
                      key={qty}
                      disabled={!party.live || !account.canPay || busy !== undefined}
                      onClick={() => void buy(row, qty)}
                      aria-label={`Buy ${qty} ${row.ticker}`}
                      className={qty === 1 ? 'pv-btn is-gold' : 'pv-btn'}
                    >
                      {qty === 1 ? 'Buy' : `×${qty}`}
                    </button>
                  ))}
                </div>
                {reward && (
                  <div
                    key={reward.key}
                    className="pv-won"
                    role="status"
                    onAnimationEnd={(e) => {
                      if (e.target === e.currentTarget) setWon((w) => (w?.key === reward.key ? undefined : w))
                    }}
                  >
                    <StockLogo id={row.token} size={30} />+{(reward.qty * 0.001).toFixed(3)} {reward.ticker}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {!account.canPay && <p className="pv-wait">Setting up your account…</p>}
        {!party.live && settlement && (
          <div className="pv-settle">
            <p>
              <span className="text-muted">Shares: </span>
              {settlementNote(settlement.status).text}{' '}
              {settleHash(settlement) && account.config && (
                <a
                  className="text-xs text-muted hover:text-ink"
                  href={`${explorer(account.config.network)}/txns/${settleHash(settlement)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  delivery receipt ↗
                </a>
              )}
            </p>
            {settlement.ops.length > 0 && account.config && (
              <ol className="mt-2 list-decimal pl-5 text-xs text-muted">
                {settlement.ops.map((op, i) => (
                  <li key={i}>
                    {stepLabel(op, (id) => tokens[id as keyof typeof tokens]?.ticker ?? id.toUpperCase())}{' '}
                    {op.hash ? (
                      <a
                        className="hover:text-ink"
                        href={`${explorer(account.config!.network)}/txns/${op.hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx ↗
                      </a>
                    ) : (
                      `(${op.status})`
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>
      <aside className="pv-side" hidden={walking}>
        <button onClick={() => setWalking(true)} className="pv-walk">
          <img src="/landing/door-city.webp" alt="" />
          <span className="pv-walk-tag">As your avatar</span>
          <span className="pv-walk-name">Walk in the club</span>
          <span className="pv-walk-go" aria-hidden>
            Enter
          </span>
        </button>
        <section className="pv-tab" aria-label="Your drinks">
          <div className="pv-tab-hd">
            <b>Your drinks</b>
            <span>{party.title}</span>
          </div>
          {drinks.length === 0 && <p className="pv-tab-empty">Nothing yet. Every drink is a slice of a share.</p>}
          <ul>
            {drinks.map((d) => (
              <li key={d.key} className={`pv-ln is-${d.state}`}>
                <div className="pv-ln-row">
                  <span>
                    {d.qty} × {d.ticker}
                  </span>
                  <span>{usd(d.total)}</span>
                </div>
                <div className="pv-ln-st">
                  {d.state === 'pending' ? 'paying…' : d.state === 'done' ? 'paid' : 'not paid'}
                  {d.state === 'done' && d.note && account.config && (
                    <a href={`${explorer(account.config.network)}/txns/${d.note}`} target="_blank" rel="noreferrer">
                      receipt ↗
                    </a>
                  )}
                </div>
                {d.state === 'failed' && d.note && <div className="pv-ln-why">{d.note}</div>}
              </li>
            ))}
          </ul>
          {paid.length > 0 && (
            <div className="pv-tab-tot">
              <span>Paid</span>
              <span>{usd(paid.reduce((n, d) => n + d.total, 0))}</span>
            </div>
          )}
        </section>
      </aside>
    </div>
  )
}

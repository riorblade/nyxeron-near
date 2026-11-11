// One City party as a guest: the host's menu in dollars, buy a drink in one tap. The drink shows up at once and is
// marked done when the relay confirms it; a refusal explains itself.
import { tokens } from '@nyxeron/game'
import type { InferResponseType } from 'hono/client'
import { useCallback, useEffect, useState } from 'react'
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

// The club level behind the party. The api doesn't carry the host's venue level yet, so every party is The Basement.
const CLUB_LEVEL = 1

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
      <section className="rounded-2xl border border-line bg-panel/80 p-4 backdrop-blur">
        <p className="text-down">{error}</p>
        <Link href="/city" className="mt-2 inline-block text-sm text-muted hover:text-ink">
          ← All parties
        </Link>
      </section>
    )
  if (!party) return <p className="text-muted">Loading the party…</p>

  const isHost = Boolean(account.address && party.host.nearAccount === account.address)
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
      <ClubBackdrop
        level={CLUB_LEVEL}
        moves={party.live ? party.moves.map((m) => m.kind) : []}
        pyroAt={party.pyroAt}
        walk={walking ? { name: account.profile?.name || 'Guest', onExit: () => setWalking(false) } : undefined}
      />
      {isHost && party.live && !walking && (
        <div className="md:col-span-2">
          <HostPrices
            account={account}
            partyId={partyId}
            menu={party.menu.map((m) => ({ ...m, price: m.listPrice }))}
            onSaved={() => void load()}
          />
        </div>
      )}
      {isHost && party.live && !walking && (
        <div className="md:col-span-2">
          <HostMoves
            account={account}
            partyId={partyId}
            active={party.moves.map((m) => m.kind)}
            happyHourUsed={party.happyHourUsed}
            onDone={() => void load()}
          />
        </div>
      )}
      <section className={`rounded-2xl border border-line bg-panel/80 p-4 backdrop-blur ${walking ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <Link href="/city" className="text-xs text-muted hover:text-ink">
            ← All parties
          </Link>
          <button
            onClick={() => setWalking(true)}
            className="rounded-full border border-neon/50 px-3 py-1 text-xs font-semibold text-neon hover:bg-neon/10"
          >
            Walk in the club
          </button>
        </div>
        <h2 className="text-xl font-bold">{party.title}</h2>
        <p className="text-sm text-muted">
          {isHost ? 'Your party' : `Hosted by ${party.host.name || 'a host'}`} ·{' '}
          {party.live ? `until ${new Date(party.endsAt).toLocaleTimeString([], { timeStyle: 'short' })}` : 'not open'}
        </p>
        {party.live && party.moves.some((m) => m.kind === 'happyHour') && (
          <p className="mt-2 rounded-lg bg-gold/15 px-3 py-1.5 text-sm font-semibold text-gold">
            Happy hour: 20 % off every drink until{' '}
            {new Date(party.moves.find((m) => m.kind === 'happyHour')!.until).toLocaleTimeString([], {
              timeStyle: 'short',
            })}
          </p>
        )}
        <ul className="mt-3 divide-y divide-line">
          {party.menu.map((row) => (
            <li key={row.token} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="font-semibold">{row.ticker}</div>
                <div className="text-xs text-muted">
                  {tokens[row.token as keyof typeof tokens]?.name ?? row.name} · 0.001 share
                </div>
              </div>
              <div className="flex items-center gap-2">
                {row.price < row.listPrice && (
                  <span className="text-xs text-muted tabular-nums line-through">{usd(row.listPrice)}</span>
                )}
                <span className="font-semibold tabular-nums">{usd(row.price)}</span>
                {[1, 3].map((qty) => (
                  <button
                    key={qty}
                    disabled={!party.live || !account.canPay || busy !== undefined}
                    onClick={() => void buy(row, qty)}
                    className="rounded-lg bg-neon px-3 py-1.5 text-sm font-bold text-night disabled:opacity-40"
                  >
                    {qty === 1 ? 'Buy' : `×${qty}`}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {!account.canPay && <p className="mt-3 text-xs text-muted">Setting up your account…</p>}
        {!party.live && settlement && (
          <p className="mt-3 text-sm">
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
        )}
        {!party.live && settlement && settlement.ops.length > 0 && account.config && (
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
      </section>
      <section className={`rounded-2xl border border-line bg-panel/80 p-4 backdrop-blur ${walking ? 'hidden' : ''}`}>
        <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Your drinks</h3>
        {drinks.length === 0 && <p className="text-sm text-muted">Nothing yet. Every drink is a slice of a share.</p>}
        <ul className="space-y-2 text-sm">
          {drinks.map((d) => (
            <li
              key={d.key}
              className={d.state === 'failed' ? 'text-down' : d.state === 'done' ? 'text-up' : 'text-ink'}
            >
              <span className="font-semibold">
                {d.qty} × {d.ticker}
              </span>{' '}
              {usd(d.total)} · {d.state === 'pending' ? 'paying…' : d.state === 'done' ? 'paid' : 'not paid'}
              {d.state === 'failed' && d.note && <div className="text-xs">{d.note}</div>}
              {d.state === 'done' && d.note && account.config && (
                <a
                  className="ml-1 text-xs text-muted hover:text-ink"
                  href={`${explorer(account.config.network)}/txns/${d.note}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  receipt ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

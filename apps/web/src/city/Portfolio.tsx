// The player's stock units on NEAR (NEP-245 on our contract), their dollars, and "Collect shares": per party they bought
// at, what is still owed to them (owed(party) on chain) and where the delivery is (the api's settlement job).
import { tokens } from '@nyxeron/game'
import { useCallback, useEffect, useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { explorer, nearProvider, view } from '../near/chain.ts'
import { Link } from '../router.tsx'
import { type Owed, owedTo, shares, unitsByToken } from './holdings.ts'
import { type Settlement, settleHash, settlementNote } from './settlement.ts'
import { visitedParties } from './visited.ts'

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

  const held = Object.entries(state?.units ?? {})
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Your portfolio</h2>
      <p className="text-sm">
        Dollars: <span className="font-semibold">{account.balance === undefined ? '…' : usd(account.balance)}</span>
      </p>
      {error && <p className="mt-2 text-sm text-down">{error}</p>}
      {!state && !error && <p className="mt-2 text-sm text-muted">Reading your shares…</p>}
      {state && (
        <>
          <h3 className="mt-3 text-xs text-muted">Shares you hold</h3>
          {held.length === 0 ? (
            <p className="text-sm text-muted">None yet. Buy drinks at a party and collect them after.</p>
          ) : (
            <ul className="text-sm">
              {held.map(([id, units]) => (
                <li key={id} className="flex justify-between tabular-nums">
                  <span>{ticker(id)}</span>
                  <span>
                    {shares(units)} share <span className="text-muted">({units} drinks)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-3 text-xs text-muted">Collect shares</h3>
          {!state.owedReady ? (
            <p className="text-sm text-muted">Shares from parties show here once the new contract is live.</p>
          ) : state.parties.length === 0 ? (
            <p className="text-sm text-muted">Nothing waiting. Shares from a party arrive after it ends.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {state.parties.map((p) => (
                <CollectRow key={p.id} party={p} explorerUrl={config ? explorer(config.network) : ''} />
              ))}
            </ul>
          )}
          {config && address && (
            <a
              className="mt-3 inline-block text-xs text-muted hover:text-ink"
              href={`${explorer(config.network)}/address/${address}`}
              target="_blank"
              rel="noreferrer"
            >
              See it on chain ↗
            </a>
          )}
        </>
      )}
    </section>
  )
}

function CollectRow({ party, explorerUrl }: { party: PartyShares; explorerUrl: string }) {
  const owed = Object.entries(party.owed)
  const note = party.settlement ? settlementNote(party.settlement.status) : undefined
  const hash = party.settlement ? settleHash(party.settlement) : undefined
  return (
    <li>
      <Link href={`/city/party/${party.id}`} className="font-semibold hover:text-neon">
        {party.title}
      </Link>
      {owed.length > 0 && (
        <span className="tabular-nums">
          {' '}
          · {owed.map(([id, units]) => `${shares(units)} ${ticker(id)}`).join(', ')}
        </span>
      )}
      {note && <div className={`text-xs ${TONE[note.tone]}`}>{note.text}</div>}
      {hash && (
        <a
          className="text-xs text-muted hover:text-ink"
          href={`${explorerUrl}/txns/${hash}`}
          target="_blank"
          rel="noreferrer"
        >
          delivery receipt ↗
        </a>
      )}
    </li>
  )
}

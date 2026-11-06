// The player's stock units on NEAR (NEP-245 on our contract), their dollars, and the shares still owed to them from
// parties ("Collect shares"): all read from chain, nothing from the api's say-so.
import { tokens } from '@nyxeron/game'
import { useEffect, useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { explorer, nearProvider, view } from '../near/chain.ts'
import { type Owed, owedTo, shares, unitsByToken } from './holdings.ts'
import { visitedParties } from './visited.ts'

type State = {
  units: Record<string, number>
  owed: Record<number, Record<string, number>>
  owedReady: boolean // false while the deployed contract has no owed() yet
}

const ticker = (id: string) => tokens[id as keyof typeof tokens]?.ticker ?? id.toUpperCase()

export function Portfolio({ account }: { account: Account }) {
  const [state, setState] = useState<State>()
  const [error, setError] = useState<string>()
  const { config, address } = account

  useEffect(() => {
    if (!config || !address) return
    const provider = nearProvider(config.network)
    void (async () => {
      try {
        const registry = (await view<[string, unknown][]>(provider, config.contractId, 'tokens')) ?? []
        const ids = registry.map(([id]) => id)
        const balances = ids.length
          ? await view<string[]>(provider, config.contractId, 'mt_batch_balance_of', {
              account_id: address,
              token_ids: ids,
            })
          : []
        const byParty: Record<number, Owed[] | undefined> = {}
        let owedReady = true
        for (const party of visitedParties()) {
          const rows = await view<Owed[]>(provider, config.contractId, 'owed', { party: String(party) })
          if (rows === undefined) owedReady = false
          byParty[party] = rows
        }
        setState({ units: unitsByToken(ids, balances), owed: owedTo(address, byParty), owedReady })
      } catch {
        setError("Couldn't read your shares right now.")
      }
    })()
  }, [config, address])

  const held = Object.entries(state?.units ?? {})
  const owed = Object.entries(state?.owed ?? {})
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
          ) : owed.length === 0 ? (
            <p className="text-sm text-muted">Nothing waiting. Shares from a party arrive after it ends.</p>
          ) : (
            <ul className="text-sm">
              {owed.map(([party, byToken]) => (
                <li key={party}>
                  Party #{party}:{' '}
                  {Object.entries(byToken)
                    .map(([id, units]) => `${shares(units)} ${ticker(id)}`)
                    .join(', ')}{' '}
                  <span className="text-muted">· delivered when the party settles</span>
                </li>
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

// /proof: what is on chain behind the game, for judges and the curious. The one page where NEAR and Robinhood Chain
// are named. The shares behind the units and each party's steps come from the api's public proof (proof.ts).
import { tokens } from '@nyxeron/game'
import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { explorer, nearProvider, type Network, view } from '../near/chain.ts'
import { Link } from '../router.tsx'
import { stepLabel } from '../city/settlement.ts'
import { backedText, type PartySteps, proofLink, proofText, type ProofView } from './proof.ts'

type Config = { network: Network; contractId: string; usdcId: string; quoteKey: string | null }
type Registered = [string, { symbol: string; backing: string; shares_per_unit: string }]

export function Proof() {
  const [config, setConfig] = useState<Config>()
  const [registry, setRegistry] = useState<Registered[]>()
  const [proof, setProof] = useState<ProofView | null>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    void (async () => {
      try {
        const c = (await (await api.config.$get()).json()) as Config
        setConfig(c)
        setRegistry((await view<Registered[]>(nearProvider(c.network), c.contractId, 'tokens')) ?? [])
      } catch {
        setError("Couldn't read the chain right now.")
      }
    })()
    void (async () => {
      const r = await api.proof.$get().catch(() => undefined)
      setProof(r?.ok ? ((await r.json()) as ProofView) : null)
    })()
  }, [])

  const near = config ? explorer(config.network) : ''
  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-16">
      <Link href="/" className="text-xs text-muted hover:text-ink">
        ← NYXERON
      </Link>
      <h1 className="text-2xl font-bold">Proof</h1>
      <p className="mt-1 text-muted">
        Every drink is a slice of a real share. Here is where each piece lives, so you can check it yourself.
      </p>
      {error && <p className="mt-4 text-down">{error}</p>}
      {config && (
        <section className="mt-5 rounded-2xl border border-line bg-panel p-4 text-sm">
          <h2 className="mb-2 font-semibold">On NEAR ({config.network})</h2>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
            <dt className="text-muted">Game contract</dt>
            <dd>
              <a
                className="text-neon hover:underline"
                href={`${near}/address/${config.contractId}`}
                target="_blank"
                rel="noreferrer"
              >
                {config.contractId} ↗
              </a>
            </dd>
            <dt className="text-muted">Dollars (USDC)</dt>
            <dd className="break-all">
              <a
                className="text-neon hover:underline"
                href={`${near}/address/${config.usdcId}`}
                target="_blank"
                rel="noreferrer"
              >
                {config.usdcId} ↗
              </a>
            </dd>
            <dt className="text-muted">Price signing key</dt>
            <dd className="break-all">{config.quoteKey ?? 'not set'}</dd>
          </dl>
          <p className="mt-3 text-muted">
            Stock units are NEP-245 tokens on the game contract: 1 unit = 0.001 share. Registered on chain:
          </p>
          <ul className="mt-1">
            {(registry ?? []).map(([id, info]) => (
              <li key={id} className="tabular-nums">
                <span className="font-semibold">{info.symbol}</span> · {info.shares_per_unit} share per unit · backed by{' '}
                <span className="break-all text-muted">{info.backing}</span>
              </li>
            ))}
            {registry?.length === 0 && <li className="text-muted">No stock registered yet.</li>}
          </ul>
        </section>
      )}
      {proof && <Hood proof={proof} />}
      {proof === null && (
        <p className="mt-4 text-sm text-down">Couldn't read the parties right now. Try again in a minute.</p>
      )}
      {proof && config && <Backing proof={proof} />}
      {proof && config && <Parties proof={proof} network={config.network} />}
    </main>
  )
}

/** Where the shares live: Robinhood's stock tokens on Robinhood Chain, or synthetic stand-ins on its testnet. */
function Hood({ proof }: { proof: ProofView }) {
  const { hood } = proof
  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm">
      <h2 className="mb-2 font-semibold">
        On Robinhood Chain {hood.synthetic ? 'testnet ' : ''}(id {hood.chainId})
      </h2>
      {hood.synthetic ? (
        <p className="text-muted">
          Robinhood's stock tokens don't exist on its testnet, so here the game's warehouse buys{' '}
          <span className="text-ink">synthetic stand-ins</span> (sTSLA, sNVDA, …) for test dollars, at the live market
          price, from a small market contract. They are worth nothing; the purchase, the warehouse address (controlled
          by a NEAR account through Chain Signatures, no private key anywhere) and the checks are the same as on
          mainnet. The warehouse holds these token addresses:
        </p>
      ) : (
        <p className="text-muted">
          The shares themselves are Robinhood stock tokens, held by the game's warehouse address, which a NEAR account
          controls through Chain Signatures (no private key anywhere). The menu only uses these pinned token addresses:
        </p>
      )}
      <ul className="mt-2">
        {hood.tokens.map((t) => (
          <li key={t.token} className="tabular-nums">
            <span className="inline-block w-14 font-semibold">
              {hood.synthetic ? 's' : ''}
              {t.ticker}
            </span>
            <a
              className="break-all text-muted hover:text-ink"
              href={`${hood.explorer}/address/${t.address}`}
              target="_blank"
              rel="noreferrer"
            >
              {t.address}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

const ticker = (id: string) => tokens[id as keyof typeof tokens]?.ticker ?? id.toUpperCase()

/** Units on the contract against the shares behind them (the warehouse's balance, when it buys). */
function Backing({ proof }: { proof: ProofView }) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm">
      <h2 className="mb-2 font-semibold">
        Shares behind the units{proof.hood.synthetic && !proof.demo ? ' (synthetic, testnet)' : ''}
      </h2>
      {proof.demo ? (
        <p className="text-muted">
          On testnet the share purchase after a party is simulated: each mint carries a <code>demo:</code> proof, and no
          real share stands behind these units. On mainnet the warehouse buys the shares first, and this table shows
          what it holds.
        </p>
      ) : (
        proof.warehouse && (
          <p className="break-all text-muted">
            Warehouse on Robinhood Chain{proof.hood.synthetic ? ' testnet' : ''}:{' '}
            <a
              className="text-ink hover:underline"
              href={`${proof.hood.explorer}/address/${proof.warehouse}`}
              target="_blank"
              rel="noreferrer"
            >
              {proof.warehouse} ↗
            </a>
          </p>
        )
      )}
      {proof.tokens.length === 0 ? (
        <p className="mt-2 text-muted">No units minted yet.</p>
      ) : (
        <table className="mt-2 w-full tabular-nums">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="font-normal">Stock</th>
              <th className="font-normal">Units</th>
              <th className="font-normal">Shares owed</th>
              {!proof.demo && <th className="font-normal">Shares held</th>}
            </tr>
          </thead>
          <tbody>
            {proof.tokens.map((t) => {
              const b = backedText(t)
              return (
                <tr key={t.token}>
                  <td className="font-semibold">{t.ticker}</td>
                  <td>
                    {t.units}
                    {t.simulatedUnits !== '0' && (
                      <span className="text-muted"> ({t.simulatedUnits} simulated earlier)</span>
                    )}
                  </td>
                  <td>{t.sharesOwed}</td>
                  {!proof.demo && (
                    <td>
                      {t.sharesHeld ?? '…'} {b && <span className={b.ok ? 'text-up' : 'text-down'}>{b.text}</span>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** The latest settled parties; one opens to its steps, each with its NEAR tx. */
function Parties({ proof, network }: { proof: ProofView; network: Network }) {
  const [open, setOpen] = useState<string>()
  const [steps, setSteps] = useState<Record<string, PartySteps | null>>({})

  const toggle = async (id: string) => {
    setOpen((o) => (o === id ? undefined : id))
    if (steps[id] !== undefined) return
    const r = await api.proof.parties[':chainParty'].$get({ param: { chainParty: id } }).catch(() => undefined)
    const body = r?.ok ? await r.json() : null
    setSteps((s) => ({ ...s, [id]: body }))
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm">
      <h2 className="mb-2 font-semibold">Party by party</h2>
      <p className="text-muted">
        After a party ends: its money is released for the shares, the shares are bought and minted as units, and the
        units are delivered to the guests.
      </p>
      {proof.recent.length === 0 && <p className="mt-2 text-muted">No party has settled yet.</p>}
      <ul className="mt-2 divide-y divide-line">
        {proof.recent.map((p) => {
          const s = steps[p.chainParty]
          return (
            <li key={p.chainParty} className="py-2">
              <button
                className="flex w-full items-baseline justify-between gap-3 text-left hover:text-ink"
                aria-expanded={open === p.chainParty}
                onClick={() => void toggle(p.chainParty)}
              >
                <span className="font-semibold">{p.title}</span>
                <span className="shrink-0 text-xs text-muted">
                  {new Date(p.endsAt).toLocaleString()} · {p.status}
                </span>
              </button>
              {open === p.chainParty && (
                <div className="mt-1 text-xs text-muted">
                  {s === undefined && 'Loading…'}
                  {s === null && "Couldn't read this party right now."}
                  {s?.steps.length === 0 && 'Nobody bought a drink at this party, so there was nothing to deliver.'}
                  {s && s.steps.length > 0 && (
                    <ol className="list-decimal pl-5">
                      {s.steps.map((op, i) => (
                        <li key={i}>
                          {stepLabel(op, ticker)}{' '}
                          {op.hash ? (
                            <a
                              className="hover:text-ink"
                              href={`${explorer(network)}/txns/${op.hash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              tx ↗
                            </a>
                          ) : (
                            `(${op.status})`
                          )}
                          {'proof' in op && proofText(op.proof, proof.hood) && (
                            <span className="block break-all" title={op.proof ?? undefined}>
                              proof: {proofText(op.proof, proof.hood)}{' '}
                              {proofLink(op.proof, proof.hood) && (
                                <a
                                  className="hover:text-ink"
                                  href={proofLink(op.proof, proof.hood)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  swap ↗
                                </a>
                              )}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

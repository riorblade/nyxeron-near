// /proof: what is on chain behind the game, for judges and the curious. The one page where NEAR and Robinhood Chain
// are named. The shares behind the units and each party's steps come from the api's public proof (proof.ts).
import './proof.css'
import { tokens } from '@nyxeron/game'
import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { Mark } from '../Mark.tsx'
import { explorer, nearProvider, type Network, view } from '../near/chain.ts'
import { Link } from '../router.tsx'
import { stepLabel } from '../city/settlement.ts'
import { StockLogo } from '../stock/StockLogo.tsx'
import { backedText, type PartySteps, proofLink, proofText, type ProofView } from './proof.ts'

type Config = { network: Network; contractId: string; usdcId: string; quoteKey: string | null }
type Registered = [string, { symbol: string; backing: string; shares_per_unit: string }]

// A held balance read from chain can carry 14+ decimals; six are plenty for 0.001-share units (the full value is the title).
const roundShares = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n.toFixed(6).replace(/\.?0+$/, '') : s
}

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
    <main className="pv">
      <img className="pv-bg" src="/landing/intro.webp" alt="" aria-hidden />
      <div className="pv-shade" aria-hidden />
      <header className="pv-top">
        <Link href="/" className="pv-brand">
          <Mark className="size-6" />
          <span>Nyxeron</span>
        </Link>
        <span className="pv-kicker">The vault · on chain</span>
      </header>
      <h1 className="pv-sign">Proof</h1>
      <p className="pv-lede">
        Every drink is a slice of a real share. Here is where each piece lives, so you can check it yourself.
      </p>
      {error && <p className="pv-err">{error}</p>}

      <div className="pv-grid">
        {(config || proof) && (
          <section className="pv-panel pv-keys">
            <h2 className="pv-h">The keys</h2>
            {config && (
              <>
                <h3 className="pv-chain">On NEAR ({config.network})</h3>
                <dl className="pv-dl">
                  <dt>Game contract</dt>
                  <dd>
                    <a
                      className="pv-link"
                      href={`${near}/address/${config.contractId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {config.contractId} ↗
                    </a>
                  </dd>
                  <dt>Dollars (USDC)</dt>
                  <dd>
                    <a className="pv-link" href={`${near}/address/${config.usdcId}`} target="_blank" rel="noreferrer">
                      {config.usdcId} ↗
                    </a>
                  </dd>
                  <dt>Price signing key</dt>
                  <dd>{config.quoteKey ?? 'not set'}</dd>
                </dl>
                <p className="pv-note">Stock units are NEP-245 tokens on the game contract: 1 unit = 0.001 share.</p>
              </>
            )}
            {proof && <Hood proof={proof} />}
          </section>
        )}
        {(config || proof) && (
          <Stocks registry={registry} proof={proof ?? undefined} loading={Boolean(config) && !registry} />
        )}
      </div>
      {proof === null && <p className="pv-err">Couldn't read the parties right now. Try again in a minute.</p>}
      {proof && config && <Parties proof={proof} network={config.network} />}
    </main>
  )
}

/** Where the shares live: Robinhood's stock tokens on Robinhood Chain, or synthetic stand-ins on its testnet. */
function Hood({ proof }: { proof: ProofView }) {
  const { hood } = proof
  return (
    <>
      <h3 className="pv-chain">
        On Robinhood Chain {hood.synthetic ? 'testnet ' : ''}(id {hood.chainId})
      </h3>
      {!proof.demo && proof.warehouse && (
        <dl className="pv-dl">
          <dt>Warehouse</dt>
          <dd>
            <a
              className="pv-link"
              href={`${hood.explorer}/address/${proof.warehouse}`}
              target="_blank"
              rel="noreferrer"
            >
              {proof.warehouse} ↗
            </a>
          </dd>
        </dl>
      )}
      {hood.synthetic ? (
        <p className="pv-note">
          Robinhood's stock tokens don't exist on its testnet, so here the game's warehouse buys{' '}
          <b>synthetic stand-ins</b> (sTSLA, sNVDA, …) for test dollars, at the live market price, from a small market
          contract. They are worth nothing; the purchase, the warehouse address (controlled by a NEAR account through
          Chain Signatures, no private key anywhere) and the checks are the same as on mainnet. Each stock card lists
          the token address the warehouse holds.
        </p>
      ) : (
        <p className="pv-note">
          The shares themselves are Robinhood stock tokens, held by the game's warehouse address, which a NEAR account
          controls through Chain Signatures (no private key anywhere). The menu only uses the pinned token addresses on
          the stock cards.
        </p>
      )}
      {proof.demo && (
        <p className="pv-note">
          On testnet the share purchase after a party is simulated: each mint carries a <code>demo:</code> proof, and no
          real share stands behind these units. On mainnet the warehouse buys the shares first, and the cards show what
          it holds.
        </p>
      )}
    </>
  )
}

const ticker = (id: string) => tokens[id as keyof typeof tokens]?.ticker ?? id.toUpperCase()
const name = (id: string) => tokens[id as keyof typeof tokens]?.name

/** One card per stock: its units on NEAR, its token on Robinhood Chain, and the shares behind the units. */
function Stocks({ registry, proof, loading }: { registry?: Registered[]; proof?: ProofView; loading: boolean }) {
  const reg = new Map(registry ?? [])
  const hood = new Map((proof?.hood.tokens ?? []).map((t) => [t.token, t]))
  const backing = new Map((proof?.tokens ?? []).map((t) => [t.token, t]))
  const ids = [...new Set([...reg.keys(), ...hood.keys(), ...backing.keys()])]
  const synthetic = proof?.hood.synthetic
  return (
    <section className="pv-stocks">
      <div className="pv-stocks-head">
        <h2 className="pv-h">The stocks</h2>
        <span className="pv-count">
          {reg.size} registered on chain{proof && ` · ${proof.tokens.length} with units minted`}
        </span>
      </div>
      {loading && <p className="pv-note">Reading the chain…</p>}
      {registry?.length === 0 && <p className="pv-note">No stock registered yet.</p>}
      {proof && proof.tokens.length === 0 && <p className="pv-note">No units minted yet.</p>}
      <ul className="pv-cards">
        {ids.map((id) => {
          const info = reg.get(id)
          const h = hood.get(id)
          const t = backing.get(id)
          const b = t && backedText(t)
          return (
            <li key={id} className={`pv-card${t ? ' has-units' : ''}`}>
              <div className="pv-card-top">
                <StockLogo id={id} size={44} />
                <div>
                  <b className="pv-tick">{info?.symbol ?? ticker(id)}</b>
                  <span className="pv-name">{name(id)}</span>
                </div>
                {info && <span className="pv-per">{info.shares_per_unit} share per unit</span>}
              </div>
              {t && (
                <dl className="pv-units">
                  <div>
                    <dt>Units</dt>
                    <dd>
                      {t.units}
                      {t.simulatedUnits !== '0' && <small> ({t.simulatedUnits} simulated earlier)</small>}
                    </dd>
                  </div>
                  <div>
                    <dt>Shares owed</dt>
                    <dd>{t.sharesOwed}</dd>
                  </div>
                  {!proof?.demo && (
                    <div>
                      <dt>Shares held{synthetic ? ' (synthetic)' : ''}</dt>
                      <dd>
                        <span title={t.sharesHeld ?? undefined}>{t.sharesHeld ? roundShares(t.sharesHeld) : '…'}</span>{' '}
                        {b && <span className={b.ok ? 'text-up' : 'text-down'}>{b.text}</span>}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              <dl className="pv-addr">
                {info && (
                  <>
                    <dt>Backed by (NEAR)</dt>
                    <dd>{info.backing}</dd>
                  </>
                )}
                {h && proof && (
                  <>
                    <dt>{synthetic ? `s${h.ticker} on Robinhood Chain testnet` : `${h.ticker} on Robinhood Chain`}</dt>
                    <dd>
                      <a href={`${proof.hood.explorer}/address/${h.address}`} target="_blank" rel="noreferrer">
                        {h.address} ↗
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            </li>
          )
        })}
      </ul>
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
    <section className="pv-panel pv-ledger">
      <div className="pv-stocks-head">
        <h2 className="pv-h">Party by party</h2>
        <span className="pv-count">The ledger</span>
      </div>
      <ol className="pv-flow" aria-label="After a party ends">
        <li>Its money is released for the shares</li>
        <li>The shares are bought and minted as units</li>
        <li>The units are delivered to the guests</li>
      </ol>
      {proof.recent.length === 0 && <p className="pv-note">No party has settled yet.</p>}
      <ul className="pv-rows">
        {proof.recent.map((p) => {
          const s = steps[p.chainParty]
          const isOpen = open === p.chainParty
          return (
            <li key={p.chainParty} className={isOpen ? 'is-open' : ''}>
              <button className="pv-row" aria-expanded={isOpen} onClick={() => void toggle(p.chainParty)}>
                <span className="pv-row-title">{p.title}</span>
                <span className="pv-row-when">{new Date(p.endsAt).toLocaleString()}</span>
                <span className={`pv-stamp is-${p.status}`}>{p.status}</span>
                <span className="pv-chev" aria-hidden>
                  ▾
                </span>
              </button>
              {isOpen && (
                <div className="pv-steps">
                  {s === undefined && 'Loading…'}
                  {s === null && "Couldn't read this party right now."}
                  {s?.steps.length === 0 && 'Nobody bought a drink at this party, so there was nothing to deliver.'}
                  {s && s.steps.length > 0 && (
                    <ol>
                      {s.steps.map((op, i) => (
                        <li key={i}>
                          {op.kind === 'mint' && op.token && <StockLogo id={op.token} size={20} />}
                          <span>
                            {stepLabel(op, ticker)}{' '}
                            {op.hash ? (
                              <a href={`${explorer(network)}/txns/${op.hash}`} target="_blank" rel="noreferrer">
                                tx ↗
                              </a>
                            ) : (
                              `(${op.status})`
                            )}
                            {'proof' in op && proofText(op.proof, proof.hood) && (
                              <span className="pv-proof" title={op.proof ?? undefined}>
                                proof: {proofText(op.proof, proof.hood)}{' '}
                                {proofLink(op.proof, proof.hood) && (
                                  <a href={proofLink(op.proof, proof.hood)} target="_blank" rel="noreferrer">
                                    swap ↗
                                  </a>
                                )}
                              </span>
                            )}
                          </span>
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

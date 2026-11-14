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

      <ol className="pv-path" aria-label="Where a drink's money goes">
        <li>
          <b>You pay on NEAR</b>
          <span>USDC to the game contract</span>
          {config && <Addr href={`${near}/address/${config.contractId}`} value={config.contractId} />}
        </li>
        <li>
          <b>The warehouse buys the share</b>
          <span>
            {proof?.hood.synthetic ? 'Robinhood Chain testnet' : 'Robinhood Chain'} · via NEAR Chain Signatures
          </span>
          {proof?.warehouse && (
            <Addr href={`${proof.hood.explorer}/address/${proof.warehouse}`} value={proof.warehouse} />
          )}
        </li>
        <li>
          <b>Units land in your account</b>
          <span>NEP-245 · 1 unit = 0.001 share</span>
        </li>
      </ol>

      {(config || proof) && (
        <Stocks registry={registry} proof={proof ?? undefined} loading={Boolean(config) && !registry} />
      )}
      {proof === null && <p className="pv-err">Couldn't read the parties right now. Try again in a minute.</p>}
      {proof && config && <Parties proof={proof} network={config.network} />}
      {(config || proof) && <Keys config={config} proof={proof ?? undefined} near={near} />}
    </main>
  )
}

/** 0x1234…abcd, the full value on hover. */
const short = (v: string) => (v.length > 18 ? `${v.slice(0, 8)}…${v.slice(-6)}` : v)
function Addr({ href, value }: { href?: string; value: string }) {
  const text = short(value.replace(/^robinhood:/, ''))
  return href ? (
    <a className="pv-addr" href={href} target="_blank" rel="noreferrer" title={value}>
      {text} ↗
    </a>
  ) : (
    <code className="pv-addr" title={value}>
      {text}
    </code>
  )
}

/** Everything else on chain, for whoever wants to check by hand: folded away by default. */
function Keys({ config, proof, near }: { config?: Config; proof?: ProofView; near: string }) {
  return (
    <details className="pv-panel pv-keys">
      <summary>
        <h2 className="pv-h">Keys and addresses</h2>
        <span className="pv-chev" aria-hidden>
          ▾
        </span>
      </summary>
      <dl className="pv-dl">
        {config && (
          <>
            <dt>Game contract · NEAR {config.network}</dt>
            <dd>
              <Addr href={`${near}/address/${config.contractId}`} value={config.contractId} />
            </dd>
            <dt>Dollars (USDC)</dt>
            <dd>
              <Addr href={`${near}/address/${config.usdcId}`} value={config.usdcId} />
            </dd>
            <dt>Price signing key</dt>
            <dd>{config.quoteKey ? <Addr value={config.quoteKey} /> : 'not set'}</dd>
          </>
        )}
        {proof?.warehouse && !proof.demo && (
          <>
            <dt>
              Warehouse · Robinhood Chain {proof.hood.synthetic ? 'testnet ' : ''}(id {proof.hood.chainId})
            </dt>
            <dd>
              <Addr href={`${proof.hood.explorer}/address/${proof.warehouse}`} value={proof.warehouse} />
            </dd>
          </>
        )}
      </dl>
      {proof?.hood.synthetic && (
        <p className="pv-note">
          Robinhood's stock tokens don't exist on its testnet, so here the warehouse buys <b>synthetic stand-ins</b>{' '}
          (sTSLA, sNVDA, …) at the live price. Same purchase, same Chain Signatures, same checks as mainnet.
        </p>
      )}
      {proof?.demo && (
        <p className="pv-note">
          On testnet the share purchase after a party is simulated: no real share stands behind these units.
        </p>
      )}
    </details>
  )
}

const ticker = (id: string) => tokens[id as keyof typeof tokens]?.ticker ?? id.toUpperCase()
const name = (id: string) => tokens[id as keyof typeof tokens]?.name

/** Stocks guests own: what the units stand for against what the warehouse holds. Then the rest of the menu, small. */
function Stocks({ registry, proof, loading }: { registry?: Registered[]; proof?: ProofView; loading: boolean }) {
  const reg = new Map(registry ?? [])
  const hood = new Map((proof?.hood.tokens ?? []).map((t) => [t.token, t]))
  const owned = proof?.tokens ?? []
  const rest = [...new Set([...reg.keys(), ...hood.keys()])].filter((id) => !owned.some((t) => t.token === id))
  const synthetic = proof?.hood.synthetic
  const link = (id: string) => {
    const h = hood.get(id)
    return h && proof ? `${proof.hood.explorer}/address/${h.address}` : undefined
  }
  return (
    <section className="pv-stocks">
      <div className="pv-stocks-head">
        <h2 className="pv-h">Owned by guests</h2>
        <span className="pv-count">{reg.size} stocks on the menu</span>
      </div>
      {loading && <p className="pv-note">Reading the chain…</p>}
      {proof && owned.length === 0 && <p className="pv-note">No units minted yet.</p>}
      <ul className="pv-owned">
        {owned.map((t) => {
          const b = backedText(t)
          const href = link(t.token)
          return (
            <li key={t.token} className="pv-card">
              <div className="pv-card-top">
                <StockLogo id={t.token} size={44} />
                <div>
                  <b className="pv-tick">{reg.get(t.token)?.symbol ?? ticker(t.token)}</b>
                  <span className="pv-name">{name(t.token)}</span>
                </div>
                {b && <span className={`pv-badge ${b.ok ? 'is-ok' : 'is-short'}`}>{b.ok ? '✓ backed' : 'short'}</span>}
              </div>
              <dl className="pv-units">
                <div>
                  <dt>Units</dt>
                  <dd>{t.units}</dd>
                </div>
                <div>
                  <dt>Shares owed</dt>
                  <dd>{t.sharesOwed}</dd>
                </div>
                {!proof?.demo && (
                  <div>
                    <dt>Held</dt>
                    <dd title={t.sharesHeld ?? undefined}>{t.sharesHeld ? roundShares(t.sharesHeld) : '…'}</dd>
                  </div>
                )}
              </dl>
              <div className="pv-card-foot">
                {t.simulatedUnits !== '0' && <span>{t.simulatedUnits} units from the early simulated run</span>}
                {href && (
                  <a
                    className="pv-addr"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    title={hood.get(t.token)?.address}
                  >
                    {synthetic ? 's' : ''}
                    {ticker(t.token)} token ↗
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {rest.length > 0 && (
        <>
          <h3 className="pv-sub">Also on the menu</h3>
          <ul className="pv-menu">
            {rest.map((id) => {
              const href = link(id)
              const inner = (
                <>
                  <StockLogo id={id} size={24} />
                  <b>{reg.get(id)?.symbol ?? ticker(id)}</b>
                </>
              )
              return (
                <li key={id}>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" title={hood.get(id)?.address}>
                      {inner}
                    </a>
                  ) : (
                    <span>{inner}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </>
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
    <section className="pv-panel pv-ledger">
      <div className="pv-stocks-head">
        <h2 className="pv-h">Party by party</h2>
        <span className="pv-count">The ledger</span>
      </div>
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

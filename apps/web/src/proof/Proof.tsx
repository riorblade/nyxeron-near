// /proof: what is on chain behind the game, for judges and the curious. The one page where NEAR and Robinhood Chain
// are named. Per-party steps (payment → swap → mint → settle) are listed once the api serves them (proof.ts).
import { tokens } from '@nyxeron/game'
import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { explorer, nearProvider, type Network, view } from '../near/chain.ts'
import { Link } from '../router.tsx'

type Config = { network: Network; contractId: string; usdcId: string; quoteKey: string | null }
type Registered = [string, { symbol: string; backing: string; shares_per_unit: string }]

export function Proof() {
  const [config, setConfig] = useState<Config>()
  const [registry, setRegistry] = useState<Registered[]>()
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
  }, [])

  const near = config ? explorer(config.network) : ''
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
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
      <section className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm">
        <h2 className="mb-2 font-semibold">On Robinhood Chain (id 4663)</h2>
        <p className="text-muted">
          The shares themselves are Robinhood stock tokens, held by the game's warehouse address, which a NEAR account
          controls through Chain Signatures (no private key anywhere). The menu only uses these pinned token addresses:
        </p>
        <ul className="mt-2">
          {Object.values(tokens).map((t) => (
            <li key={t.ticker} className="tabular-nums">
              <span className="inline-block w-14 font-semibold">{t.ticker}</span>
              <span className="break-all text-muted">{t.address}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-4 rounded-2xl border border-line bg-panel p-4 text-sm text-muted">
        Party by party (payment, share purchase, units minted, units delivered) appears here once the first City party
        has settled.
      </section>
    </main>
  )
}

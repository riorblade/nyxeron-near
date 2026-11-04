// The host's menu: one price per drink between wholesale and 3× wholesale, saved together. The api checks the same
// bounds against today's market, and the contract checks them again on every purchase.
import { useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { playerMessage } from './errors.ts'

type Row = { token: string; ticker: string; price: number; wholesale: number; maxPrice: number }
const CENT = 10_000

const HOST_ERRORS: Record<string, string> = {
  below_wholesale: "A drink can't cost less than its share.",
  above_cap: 'Three times wholesale is the most a drink can cost.',
  not_host: 'Only the host can change prices.',
}

export function HostPrices(props: { account: Account; partyId: number; menu: Row[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  const changed = Object.keys(draft).length > 0

  const save = async () => {
    const r = await props.account.api.parties[':id'].prices.$put({
      param: { id: String(props.partyId) },
      json: { prices: draft },
    })
    if (r.ok) {
      setDraft({})
      setMsg({ ok: true, text: 'Prices saved.' })
      props.onSaved()
    } else {
      const code = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? ''
      setMsg({ ok: false, text: HOST_ERRORS[code] ?? playerMessage(code) })
    }
  }

  return (
    <section className="rounded-2xl border border-gold/40 bg-panel p-4">
      <h3 className="mb-1 text-sm font-semibold tracking-wide text-gold uppercase">You're the host · your prices</h3>
      <ul className="divide-y divide-line">
        {props.menu.map((row) => {
          const value = draft[row.token] ?? row.price
          return (
            <li key={row.token} className="grid grid-cols-[4rem_1fr_6rem] items-center gap-3 py-2 text-sm">
              <span className="font-semibold">{row.ticker}</span>
              <input
                type="range"
                aria-label={`${row.ticker} price`}
                className="accent-gold"
                min={row.wholesale}
                max={row.maxPrice}
                step={CENT}
                value={value}
                onChange={(e) => setDraft((d) => ({ ...d, [row.token]: Number(e.target.value) }))}
              />
              <span className="text-right tabular-nums">
                {usd(value)} <span className="text-xs text-muted">{(value / row.wholesale).toFixed(2)}×</span>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        <button
          disabled={!changed}
          onClick={() => void save()}
          className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-night disabled:opacity-40"
        >
          Save prices
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</span>}
      </div>
    </section>
  )
}

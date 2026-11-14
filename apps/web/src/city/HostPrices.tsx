// The host's menu: one price per drink between wholesale and 3× wholesale, saved together. The api checks the same
// bounds against today's market, and the contract checks them again on every purchase.
import './party.css'
import { useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { playerMessage } from './errors.ts'
import { StockLogo } from '../stock/StockLogo.tsx'

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
    <section className="hp hp-desk">
      <div className="hp-desk-top">
        <div>
          <div className="hp-kicker">You're the host</div>
          <h3 className="hp-title is-small">Your prices</h3>
        </div>
        <span className="hp-desk-scale">Wholesale 1× to 3×</span>
      </div>
      <ul className="hp-strips">
        {props.menu.map((row) => {
          const value = draft[row.token] ?? row.price
          return (
            <li key={row.token} className={`hp-strip${row.token in draft ? ' is-moved' : ''}`}>
              <span className="hp-strip-id">
                <StockLogo id={row.token} size={34} />
                <b>{row.ticker}</b>
              </span>
              <input
                type="range"
                aria-label={`${row.ticker} price`}
                className="hp-fader"
                min={row.wholesale}
                max={row.maxPrice}
                step={CENT}
                value={value}
                onChange={(e) => setDraft((d) => ({ ...d, [row.token]: Number(e.target.value) }))}
              />
              <span className="hp-strip-read">
                <b>{usd(value)}</b>
                <i>{(value / row.wholesale).toFixed(2)}×</i>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="hp-foot">
        {msg && <span className={msg.ok ? 'text-up' : 'text-down'}>{msg.text}</span>}
        <button disabled={!changed} onClick={() => void save()} className="hp-go is-small">
          Save prices
        </button>
      </div>
    </section>
  )
}

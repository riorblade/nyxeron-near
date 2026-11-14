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
        <h3 className="hp-title is-small">Your prices</h3>
        <p className="hp-desk-note">Set what each drink costs. Everything above wholesale is yours.</p>
      </div>
      <ul className="hp-rows">
        {props.menu.map((row) => {
          const value = draft[row.token] ?? row.price
          const fill = ((value - row.wholesale) / (row.maxPrice - row.wholesale || 1)) * 100
          return (
            <li key={row.token} className={`hp-row${row.token in draft ? ' is-moved' : ''}`}>
              <StockLogo id={row.token} size={40} />
              <b className="hp-row-tick">{row.ticker}</b>
              <span className="hp-row-price">{usd(value)}</span>
              <span className="hp-row-keep">you keep {usd(value - row.wholesale)} a drink</span>
              <input
                type="range"
                aria-label={`${row.ticker} price`}
                className="hp-slider"
                style={{ '--fill': `${fill}%` } as React.CSSProperties}
                min={row.wholesale}
                max={row.maxPrice}
                step={CENT}
                value={value}
                onChange={(e) => setDraft((d) => ({ ...d, [row.token]: Number(e.target.value) }))}
              />
              <span className="hp-row-ends">
                <i>wholesale {usd(row.wholesale)}</i>
                <i>max {usd(row.maxPrice)}</i>
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

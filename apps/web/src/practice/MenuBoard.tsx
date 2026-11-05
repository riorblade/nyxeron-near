// The drinks menu with a price slider per stock, from wholesale to 3× wholesale. A price is sent to the game when the
// slider is let go, so dragging doesn't flood the night with price changes.
import { appeal, MAX_MARKUP, type Night, priceNow, type TokenId, tokenIds, tokens } from '@nyxeron/game'
import { useState } from 'react'
import { pct, usd } from '../format.ts'

const CENT = 10_000

function Row({ night, id, onPrice }: { night: Night; id: TokenId; onPrice: (id: TokenId, micro: number) => void }) {
  const item = night.menu[id]!
  const [draft, setDraft] = useState<number>()
  const value = draft ?? item.price
  const change = night.market[id]?.change24h ?? 0
  const now = priceNow(night, id)
  const markup = value / item.wholesale
  const commit = () => {
    if (draft !== undefined && draft !== item.price) onPrice(id, draft)
    setDraft(undefined)
  }
  return (
    <li className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-x-3 gap-y-1 py-2">
      <div>
        <div className="font-semibold">{tokens[id].ticker}</div>
        <div className={`text-xs ${change >= 0 ? 'text-up' : 'text-down'}`}>{pct(change)}</div>
      </div>
      <input
        type="range"
        aria-label={`${tokens[id].name} price`}
        className="w-full accent-neon"
        min={item.wholesale}
        max={item.wholesale * MAX_MARKUP}
        step={CENT}
        value={value}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <div className="w-28 text-right">
        <div className="font-semibold tabular-nums">{usd(value)}</div>
        <div className="text-xs whitespace-nowrap text-muted tabular-nums">
          {markup.toFixed(2)}× ·{' '}
          {now !== undefined && now !== item.price ? `${usd(now)} now` : `cost ${usd(item.wholesale)}`}
        </div>
      </div>
    </li>
  )
}

export function MenuBoard({ night, onPrice }: { night: Night; onPrice: (id: TokenId, micro: number) => void }) {
  const ids = tokenIds.filter((id) => night.menu[id])
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-1 text-sm font-semibold tracking-wide text-muted uppercase">Menu · 1 drink = 0.001 share</h2>
      <ul className="divide-y divide-line">
        {ids.map((id) => (
          <Row key={id} night={night} id={id} onPrice={onPrice} />
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Cheaper drinks sell more often; stocks that are up today sell better.{' '}
        {ids.length > 0 && `Most wanted now: ${tokens[best(night, ids)].ticker}.`}
      </p>
    </section>
  )
}

function best(night: Night, ids: TokenId[]): TokenId {
  return ids.reduce((a, b) => ((appeal(night, b)?.value ?? 0) > (appeal(night, a)?.value ?? 0) ? b : a))
}

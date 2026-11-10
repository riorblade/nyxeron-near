// The CEO's moves at a live party. The api checks who may and how often; every guest's club shows them.
import { useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { playerMessage } from './errors.ts'

type Kind = 'happyHour' | 'anthem' | 'mcHype' | 'pyro'
const MOVES: { kind: Kind; label: string; note: string }[] = [
  { kind: 'happyHour', label: 'Happy hour', note: '20 % off every drink for 5 min, once a party' },
  { kind: 'anthem', label: 'Anthem', note: 'the DJ drops the big one, 2 min' },
  { kind: 'mcHype', label: 'MC hype', note: 'the MC works the floor, 1 min' },
  { kind: 'pyro', label: 'Pyro', note: 'flames and CO₂ now' },
]

export function HostMoves(props: {
  account: Account
  partyId: number
  active: string[]
  happyHourUsed: boolean
  onDone: () => void
}) {
  const [busy, setBusy] = useState<Kind>()
  const [msg, setMsg] = useState<string>()
  const send = async (kind: Kind) => {
    setBusy(kind)
    setMsg(undefined)
    try {
      const r = await props.account.api.parties[':id'].moves.$post({
        param: { id: String(props.partyId) },
        json: { kind },
      })
      if (r.ok) props.onDone()
      else {
        const code = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? ''
        setMsg(code === 'too_soon' ? 'Not yet: give the crowd a moment.' : playerMessage(code))
      }
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <section className="rounded-2xl border border-gold/40 bg-panel/80 p-4 backdrop-blur">
      <h3 className="mb-2 text-sm font-semibold tracking-wide text-gold uppercase">Work the crowd</h3>
      <div className="grid gap-2 sm:grid-cols-4">
        {MOVES.map((m) => {
          const on = props.active.includes(m.kind)
          const spent = m.kind === 'happyHour' && props.happyHourUsed && !on
          return (
            <button
              key={m.kind}
              disabled={busy !== undefined || on || spent}
              onClick={() => void send(m.kind)}
              className="flex flex-col rounded-xl border border-line bg-night p-3 text-left hover:border-gold disabled:opacity-50"
            >
              <span className="font-bold">{on ? `${m.label} · on` : spent ? `${m.label} · used` : m.label}</span>
              <span className="text-xs text-muted">{m.note}</span>
            </button>
          )
        })}
      </div>
      {msg && <p className="mt-2 text-sm text-down">{msg}</p>}
    </section>
  )
}

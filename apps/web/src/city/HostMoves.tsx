// The CEO's moves at a live party. The api checks who may and how often; every guest's club shows them.
import './party.css'
import { useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { playerMessage } from './errors.ts'

type Kind = 'happyHour' | 'anthem' | 'mcHype' | 'pyro'
const MOVES: { kind: Kind; label: string; note: string; art: string }[] = [
  {
    kind: 'happyHour',
    label: 'Happy hour',
    note: '20% off every drink for 5 min, once a party',
    art: '/venue/sprites/bartender-1.webp',
  },
  { kind: 'anthem', label: 'Anthem', note: 'The DJ drops the big one, 2 min', art: '/venue/sprites/dj-deck.webp' },
  { kind: 'mcHype', label: 'MC hype', note: 'The MC works the floor, 1 min', art: '/venue/sprites/mc.webp' },
  { kind: 'pyro', label: 'Pyro', note: 'Flames and CO₂ now', art: '' },
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
    <section className="hp hp-moves">
      <div className="hp-kicker">Work the crowd</div>
      <div className="hp-move-row">
        {MOVES.map((m) => {
          const on = props.active.includes(m.kind)
          const spent = m.kind === 'happyHour' && props.happyHourUsed && !on
          return (
            <button
              key={m.kind}
              disabled={busy !== undefined || on || spent}
              onClick={() => void send(m.kind)}
              className={`hp-move is-${m.kind}${on ? ' is-on' : ''}${spent ? ' is-spent' : ''}`}
            >
              {m.art ? (
                <img className="hp-move-art" src={m.art} alt="" />
              ) : (
                <video
                  className="hp-move-art"
                  src="/venue/effect/fire.webm"
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-hidden
                />
              )}
              {on && <span className="hp-move-on">On</span>}
              {spent && <span className="hp-move-used">Used</span>}
              <span className="hp-move-name">{m.label}</span>
              <span className="hp-move-note">{m.note}</span>
            </button>
          )
        })}
      </div>
      {msg && <p className="hp-error">{msg}</p>}
    </section>
  )
}

import './party.css'
import { useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { navigate } from '../router.tsx'
import { playerMessage } from './errors.ts'

/** Host a City party: a title and how long it runs. Every drink starts at 1.5× wholesale; the host tunes it after. */
export function HostParty({ account }: { account: Account }) {
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState(10)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const r = await account.api.parties.$post({ json: { title: title.trim(), minutes } })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        return setError(
          body.error === 'bad_request' ? 'Give the party a name (2–40 letters).' : playerMessage(body.error ?? ''),
        )
      }
      const party = (await r.json()) as { id: number }
      navigate(`/city/party/${party.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="hp hp-night">
      <img className="hp-night-art" src="/landing/stairs.webp" alt="" />
      <div className="hp-kicker">Tonight you're the CEO</div>
      <h2 className="hp-title">Set up your night</h2>
      <form
        className="hp-night-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="hp-field">
          <span className="hp-step">1 · Name the party</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={40}
            placeholder="Friday Night"
            className="hp-name"
          />
        </label>
        <div className="hp-field" role="radiogroup" aria-label="Minutes">
          <span className="hp-step">2 · How long, in minutes</span>
          <div className="hp-chips">
            {[5, 10, 15, 30, 60].map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                onClick={() => setMinutes(m)}
                className={`hp-chip${minutes === m ? ' is-on' : ''}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <p className="hp-hint">Every drink starts at 1.5× wholesale. You tune the prices once it's open.</p>
        <button disabled={busy || !account.canPay} className="hp-go">
          Open the doors <span aria-hidden>↵</span>
        </button>
      </form>
      {error && <p className="hp-error">{error}</p>}
    </section>
  )
}

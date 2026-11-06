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
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Host a party</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="flex min-w-48 flex-1 flex-col text-xs text-muted">
          Name
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={40}
            placeholder="Friday Night"
            className="mt-1 rounded-lg border border-line bg-night px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col text-xs text-muted">
          Minutes
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-1 rounded-lg border border-line bg-night px-3 py-2 text-sm text-ink"
          >
            {[5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !account.canPay}
          className="rounded-xl bg-gold px-4 py-2 font-bold text-night disabled:opacity-40"
        >
          Open it
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-down">{error}</p>}
    </section>
  )
}

// The City: real parties, real dollars. Signing in creates the player's wallet; every purchase is signed by it with no
// popup and sent through our relayer, so the player never needs NEAR for fees.
import { useEffect, useState } from 'react'
import { type Account, useAccount } from '../auth/useAccount.ts'
import { Link, usePath } from '../router.tsx'
import { AccountBar } from './AccountBar.tsx'
import { HostParty } from './HostParty.tsx'
import { PartyView } from './PartyView.tsx'
import { Portfolio } from './Portfolio.tsx'

export default function City() {
  const account = useAccount()
  const path = usePath()
  const partyId = Number(path.match(/^\/city\/party\/(\d+)/)?.[1])

  if (!account.ready) return <p className="p-6 text-muted">Loading…</p>
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-muted hover:text-ink">
            ← NYXERON
          </Link>
          <h1 className="text-2xl font-bold">City</h1>
        </div>
        <Link href="/practice" className="text-sm text-muted hover:text-ink">
          Practice
        </Link>
      </header>
      {!account.authenticated ? (
        <SignIn onSignIn={() => account.login()} />
      ) : (
        <div className="flex flex-col gap-4">
          <AccountBar account={account} />
          {account.setupError && (
            <p role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
              {account.setupError}
            </p>
          )}
          {partyId ? (
            <PartyView account={account} partyId={partyId} />
          ) : (
            <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
              <div className="flex flex-col gap-4">
                <Parties account={account} />
                <HostParty account={account} />
              </div>
              <Portfolio account={account} />
            </div>
          )}
        </div>
      )}
    </main>
  )
}

function SignIn({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="mx-auto max-w-md rounded-2xl border border-line bg-panel p-6 text-center">
      <h2 className="text-xl font-bold">Party for real</h2>
      <p className="mt-2 text-sm text-muted">
        Sign in with Google to get your own account. Drinks are paid in dollars and every drink is a slice of a real
        share you keep.
      </p>
      <button onClick={onSignIn} className="mt-5 w-full rounded-xl bg-gold py-3 font-bold text-night">
        Sign in with Google
      </button>
    </section>
  )
}

type PartyRow = { id: number; title: string; host: string; endsAt: number }

function Parties({ account }: { account: Account }) {
  const [parties, setParties] = useState<PartyRow[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    const load = async () => {
      const r = await account.api.parties.$get()
      if (!r.ok) return setError("Couldn't load the parties.")
      setParties((await r.json()).parties)
    }
    void load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [account.api])
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Live parties</h2>
      {error && <p className="text-sm text-down">{error}</p>}
      {parties?.length === 0 && <p className="text-sm text-muted">No party is on right now.</p>}
      <ul className="divide-y divide-line">
        {parties?.map((p) => (
          <li key={p.id}>
            <Link href={`/city/party/${p.id}`} className="flex items-center justify-between py-3 hover:text-neon">
              <span>
                <span className="font-semibold">{p.title}</span>
                <span className="ml-2 text-sm text-muted">by {p.host || 'a host'}</span>
              </span>
              <span className="text-sm text-muted">
                ends {new Date(p.endsAt).toLocaleTimeString([], { timeStyle: 'short' })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

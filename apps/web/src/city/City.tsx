// The City: real parties, real dollars. Signing in creates the player's wallet; every purchase is signed by it with no
// popup and sent through our relayer, so the player never needs NEAR for fees.
import { useEffect, useState } from 'react'
import { type Account, useAccount } from '../auth/useAccount.ts'
import { Mark } from '../Mark.tsx'
import { Link, usePath } from '../router.tsx'
import { AccountBar } from './AccountBar.tsx'
import { HostParty } from './HostParty.tsx'
import { PartyView } from './PartyView.tsx'
import { Portfolio } from './Portfolio.tsx'
import { type Role, useRole } from './role.ts'

export default function City() {
  const account = useAccount()
  const path = usePath()
  const partyId = Number(path.match(/^\/city\/party\/(\d+)/)?.[1])
  const [role, setRole] = useRole()

  if (!account.ready) return <p className="p-6 text-muted">Loading…</p>
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-muted hover:text-ink">
            <Mark className="size-4" /> NYXERON
          </Link>
          <h1 className="text-2xl font-bold">City{role && <span className="text-muted"> · {ROLE[role].name}</span>}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {account.authenticated && role && (
            <button onClick={() => setRole(role === 'ceo' ? 'guest' : 'ceo')} className="text-muted hover:text-ink">
              Switch to {ROLE[role === 'ceo' ? 'guest' : 'ceo'].name}
            </button>
          )}
          <Link href="/practice" className="text-muted hover:text-ink">
            Practice
          </Link>
        </div>
      </header>
      {!account.authenticated || !role ? (
        <SignIn
          signedIn={account.authenticated}
          onPick={(r) => {
            setRole(r)
            if (!account.authenticated) account.login()
          }}
        />
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
          ) : role === 'ceo' ? (
            <div className="flex flex-col gap-4">
              <HostParty account={account} />
              <Parties account={account} />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
              <Parties account={account} />
              <Portfolio account={account} />
            </div>
          )}
        </div>
      )}
    </main>
  )
}

const ROLE: Record<Role, { name: string; pitch: string; cta: string }> = {
  ceo: {
    name: 'CEO',
    pitch: 'Throw a party, set the drink prices, and keep the margin on every drink your guests buy.',
    cta: 'Host as CEO',
  },
  guest: {
    name: 'guest',
    pitch: 'Walk into a live party and buy drinks. Every drink is a slice of a real share you keep.',
    cta: 'Go out as a guest',
  },
}

/** Who are you tonight? Picking one signs in with Google (if needed); the same account can switch later. */
function SignIn({ signedIn, onPick }: { signedIn: boolean; onPick: (r: Role) => void }) {
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-line bg-panel p-6 text-center">
      <h2 className="text-xl font-bold">Who are you tonight?</h2>
      <p className="mt-2 text-sm text-muted">
        {signedIn ? 'Pick one. You can switch any time.' : 'Pick one and sign in with Google. You can switch any time.'}
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {(['ceo', 'guest'] as const).map((r) => (
          <button
            key={r}
            onClick={() => onPick(r)}
            className="flex flex-col rounded-xl border border-line bg-night p-4 text-left hover:border-gold focus-visible:border-gold"
          >
            <span className="font-bold text-gold">{ROLE[r].cta}</span>
            <span className="mt-1 text-sm text-muted">{ROLE[r].pitch}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

type PartyRow = { id: number; title: string; host: string; endsAt: number; demo: boolean }

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
                {p.demo && (
                  <span className="ml-2 rounded-full bg-neon/15 px-2 py-0.5 text-xs font-semibold text-neon">
                    always on
                  </span>
                )}
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

// The City: real parties, real dollars. Signing in creates the player's wallet; every purchase is signed by it with no
// popup and sent through our relayer, so the player never needs NEAR for fees.
import './city.css'
import { useEffect, useRef, useState } from 'react'
import { audio } from '../audio/music.ts'
import { type Account, useAccount } from '../auth/useAccount.ts'
import { Mark } from '../Mark.tsx'
import { Link, navigate, usePath } from '../router.tsx'
import { AccountBar } from './AccountBar.tsx'
import { HostParty } from './HostParty.tsx'
import { PartyView } from './PartyView.tsx'
import { Portfolio } from './Portfolio.tsx'
import { type Role, useRole } from './role.ts'

/** The kick of whatever is playing, as a CSS variable the scene breathes with; still when there is no sound. */
function useBeat(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let level = 0
    const tick = () => {
      level = Math.max(audio.pulse(), level * 0.86)
      ref.current?.style.setProperty('--beat', level.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ref])
}

/** Arrow and Enter keys for a screen of picture cards, ignored while the player types in a field. */
function usePickKeys(count: number, onPick: (n: number | ((p: number) => number)) => void, onGo: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || count === 0) return
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return
      if (document.querySelector('[role="dialog"]')) return
      const n = Number(e.key) - 1
      if (Number.isInteger(n) && n >= 0 && n < count) onPick(n)
      else if (e.key === 'ArrowRight') onPick((p) => (p + 1) % count)
      else if (e.key === 'ArrowLeft') onPick((p) => (p + count - 1) % count)
      else if (e.key === 'Enter' && !(t instanceof HTMLAnchorElement || t instanceof HTMLButtonElement)) onGo()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [count, onPick, onGo])
}

export default function City() {
  const account = useAccount()
  const path = usePath()
  const partyId = Number(path.match(/^\/city\/party\/(\d+)/)?.[1])
  const [role, setRole] = useRole()
  const root = useRef<HTMLElement>(null)
  useBeat(root)

  // A party brings its own 3D club (ClubBackdrop); everywhere else the crowd clip is the room.
  const inParty = Boolean(partyId && account.authenticated && role)
  const scene = !inParty && (
    <>
      <video
        className="cy-crowd"
        src="/landing/intro.mp4"
        poster="/landing/intro.webp"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
      />
      <div className="cy-shade" aria-hidden />
    </>
  )

  if (!account.ready)
    return (
      <main ref={root} className="cy">
        {scene}
        <p className="cy-loading">Opening the doors…</p>
      </main>
    )
  return (
    <main ref={root} className={inParty ? 'cy cy-in-party' : 'cy'}>
      {scene}
      <header className="cy-top">
        <Link href="/" className="cy-brand">
          <Mark className="size-6" />
          <span>Nyxeron</span>
        </Link>
        <span className="cy-where">City{role && account.authenticated && <b> · {ROLE[role].name}</b>}</span>
        <nav className="cy-nav">
          {account.authenticated && role && (
            <button onClick={() => setRole(role === 'ceo' ? 'guest' : 'ceo')}>
              Switch to {ROLE[role === 'ceo' ? 'guest' : 'ceo'].name}
            </button>
          )}
          <Link href="/practice">Practice</Link>
        </nav>
      </header>
      {!account.authenticated || !role ? (
        <SignIn
          signedIn={account.authenticated}
          initial={role}
          onPick={(r) => {
            setRole(r)
            if (!account.authenticated) account.login()
          }}
        />
      ) : (
        <div className="cy-body">
          <AccountBar account={account} />
          {account.setupError && (
            <p role="alert" className="cy-alert">
              {account.setupError}
            </p>
          )}
          {partyId ? (
            <PartyView account={account} partyId={partyId} />
          ) : role === 'ceo' ? (
            <div className="flex flex-col gap-4">
              <HostParty account={account} />
              <Parties account={account} go={false} />
            </div>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
              <Parties account={account} go />
              <Portfolio account={account} />
            </div>
          )}
        </div>
      )}
    </main>
  )
}

const ROLE: Record<Role, { name: string; title: string; as: string; tag: string; line: string; art: string }> = {
  ceo: {
    name: 'CEO',
    title: 'Host',
    as: 'as CEO',
    tag: 'Keep the margin',
    line: 'Throw a party, price the drinks',
    art: '/landing/reveal.webp',
  },
  guest: {
    name: 'guest',
    title: 'Go out',
    as: 'as a guest',
    tag: 'Real shares',
    line: 'Buy drinks, keep the shares',
    art: '/landing/door-city.webp',
  },
}
const ROLES = ['ceo', 'guest'] as const

/** Who are you tonight? Picking one signs in with Google or email (if needed); the same account can switch later. */
function SignIn({ signedIn, initial, onPick }: { signedIn: boolean; initial: Role | null; onPick: (r: Role) => void }) {
  const [pick, setPick] = useState(initial === 'ceo' ? 0 : 1)
  const chosen = ROLES[pick]!
  usePickKeys(ROLES.length, setPick, () => onPick(chosen))
  return (
    <section className="cy-pick" aria-labelledby="cy-who">
      <h1 id="cy-who" className="cy-sign">
        Who are you tonight?
      </h1>
      <div className="cy-roles">
        {ROLES.map((r, i) => (
          <button
            key={r}
            onClick={() => onPick(r)}
            onMouseEnter={() => setPick(i)}
            onFocus={() => setPick(i)}
            aria-label={`${ROLE[r].title} ${ROLE[r].as}`}
            className={`cy-role${i === pick ? ' is-picked' : ''}${r === 'guest' ? ' is-lead' : ''}`}
          >
            <img className={artClass(ROLE[r].art)} src={ROLE[r].art} alt="" />
            <span className="cy-key" aria-hidden>
              {i + 1}
            </span>
            <span className="cy-tag">{ROLE[r].tag}</span>
            <span className="cy-name">
              {ROLE[r].title} <small>{ROLE[r].as}</small>
            </span>
            <span className="cy-line">{ROLE[r].line}</span>
          </button>
        ))}
      </div>
      <div className="cy-foot">
        <p className="cy-hint">
          {signedIn ? 'You can switch any time.' : 'Sign in with Google or email. You can switch any time.'}
        </p>
        <button className="cy-go" onClick={() => onPick(chosen)}>
          {signedIn ? `Go ${ROLE[chosen].as}` : `Sign in ${ROLE[chosen].as}`}
          <span aria-hidden>↵</span>
        </button>
      </div>
    </section>
  )
}

type PartyRow = { id: number; title: string; host: string; endsAt: number; demo: boolean }

// Club art for a party card: the always-on house party gets the bar, others rotate through the rooms.
const ROOMS = ['/landing/reveal.webp', '/landing/stairs.webp', '/landing/door-practice.webp']
// The black-and-white rooms get the club's violet light.
const MONO = new Set(['/landing/reveal.webp', '/landing/stairs.webp'])
const artClass = (src: string) => (MONO.has(src) ? 'cy-art cy-art-mono' : 'cy-art')
const roomOf = (p: PartyRow) => (p.demo ? '/landing/door-city.webp' : ROOMS[p.id % ROOMS.length]!)

/** The live parties as a stage select: the first card leads; for a guest, one gold button walks in. The CEO's gold
 *  action is opening their own party, so their list has no second one. */
function Parties({ account, go }: { account: Account; go: boolean }) {
  const [parties, setParties] = useState<PartyRow[]>()
  const [error, setError] = useState<string>()
  const [pick, setPick] = useState(0)
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
  const list = parties ?? []
  const chosen = list[Math.min(pick, list.length - 1)]
  usePickKeys(Math.min(list.length, 9), setPick, () => chosen && navigate(`/city/party/${chosen.id}`))
  return (
    <section className="cy-stage" aria-labelledby="cy-live">
      <h2 id="cy-live" className="cy-h">
        Tonight&apos;s parties
      </h2>
      {error && <p className="cy-err">{error}</p>}
      {parties?.length === 0 && (
        <div className="cy-closed">
          <span className="cy-closed-sign" aria-hidden>
            Closed
          </span>
          <p>No party is on right now.</p>
        </div>
      )}
      {list.length > 0 && (
        <ul className="cy-stages">
          {list.map((p, i) => (
            <li key={p.id} className={i === 0 ? 'is-lead' : undefined}>
              <Link
                href={`/city/party/${p.id}`}
                className={`cy-party${p === chosen ? ' is-picked' : ''}`}
                onMouseEnter={() => setPick(i)}
                onFocus={() => setPick(i)}
              >
                <img className={artClass(roomOf(p))} src={roomOf(p)} alt="" />
                <span className="cy-open" aria-label="Open now">
                  Open
                </span>
                {i < 9 && (
                  <span className="cy-key" aria-hidden>
                    {i + 1}
                  </span>
                )}
                <span className="cy-tag">{p.demo ? 'Always on' : `Ends ${endsAt(p.endsAt)}`}</span>
                <span className="cy-name">{p.title}</span>
                <span className="cy-line">
                  by {p.host || 'a host'}
                  {p.demo && ` · ends ${endsAt(p.endsAt)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {go && chosen && (
        <Link href={`/city/party/${chosen.id}`} className="cy-go">
          Join {chosen.title}
          <span aria-hidden>↵</span>
        </Link>
      )}
    </section>
  )
}

const endsAt = (ms: number) => new Date(ms).toLocaleTimeString([], { timeStyle: 'short' })

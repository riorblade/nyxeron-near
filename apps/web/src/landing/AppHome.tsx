// app.nyxeron.xyz's home, built like a game's mode select: the crowd behind, three doors, one gold button.
import './app-home.css'
import { tokenIds, tokens } from '@nyxeron/game'
import { useEffect, useRef, useState } from 'react'
import { audio } from '../audio/music.ts'
import { Mark } from '../Mark.tsx'
import { loadMarket, type MarketSource } from '../practice/market.ts'
import { Link, navigate } from '../router.tsx'

const DOORS = [
  {
    href: '/practice',
    key: '1',
    name: 'Practice',
    tag: 'Free · no sign-in',
    line: 'Run The Basement',
    art: 'door-practice',
  },
  {
    href: '/city',
    key: '2',
    name: 'City',
    tag: 'Real shares · testnet',
    line: 'Join a party, buy the drinks',
    art: 'door-city',
  },
  { href: '/proof', key: '3', name: 'Proof', tag: 'On chain', line: 'Check every share', art: 'door-proof' },
] as const

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`

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

export function AppHome() {
  const root = useRef<HTMLElement>(null)
  const [pick, setPick] = useState(1)
  const [market, setMarket] = useState<MarketSource>()
  useBeat(root)

  useEffect(() => {
    void loadMarket().then(setMarket)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = DOORS.findIndex((d) => d.key === e.key)
      if (n >= 0) setPick(n)
      else if (e.key === 'ArrowRight') setPick((p) => (p + 1) % DOORS.length)
      else if (e.key === 'ArrowLeft') setPick((p) => (p + DOORS.length - 1) % DOORS.length)
      else if (e.key === 'Enter' && !(e.target instanceof HTMLAnchorElement)) navigate(DOORS[pick]!.href)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [pick])

  const chosen = DOORS[pick]!
  const quotes = market ? tokenIds.filter((id) => market.market[id]) : []

  return (
    <main ref={root} className="ah">
      <video
        className="ah-crowd"
        src="/landing/intro.mp4"
        poster="/landing/intro.webp"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
      />
      <div className="ah-shade" aria-hidden />

      <header className="ah-top">
        <a href="https://nyxeron.xyz" className="ah-brand">
          <Mark className="size-7" />
          <span>Nyxeron</span>
        </a>
      </header>

      <h1 className="ah-sign">Where to tonight?</h1>

      <nav className="ah-doors" aria-label="Choose how to play">
        {DOORS.map((d, i) => (
          <Link
            key={d.href}
            href={d.href}
            className={`ah-door${i === pick ? ' is-picked' : ''}${d.name === 'City' ? ' is-lead' : ''}`}
            onMouseEnter={() => setPick(i)}
            onFocus={() => setPick(i)}
          >
            <img className={`ah-art ah-art-${d.art}`} src={`/landing/${d.art}.webp`} alt="" />
            <span className="ah-key" aria-hidden>
              {d.key}
            </span>
            {d.name === 'City' && (
              <span className="ah-open" aria-label="Open now">
                Open
              </span>
            )}
            <span className="ah-tag">{d.tag}</span>
            <span className="ah-name">{d.name}</span>
            <span className="ah-line">{d.line}</span>
          </Link>
        ))}
      </nav>

      <Link href={chosen.href} className="ah-go">
        Enter {chosen.name}
        <span aria-hidden>↵</span>
      </Link>

      {market && quotes.length > 0 && (
        <div className="ah-ticker" aria-label={market.live ? 'Live stock prices' : 'Stock prices from 5 Nov 2026'}>
          <div className="ah-run">
            {[0, 1].map((copy) => (
              <span key={copy} className="ah-set" aria-hidden={copy === 1}>
                {quotes.map((id) => {
                  const q = market.market[id]!
                  return (
                    <span key={id} className="ah-q">
                      <b>{tokens[id].ticker}</b> {usd(q.priceUsd)}{' '}
                      <i className={q.change24h >= 0 ? 'up' : 'down'}>{pct(q.change24h)}</i>
                    </span>
                  )
                })}
                {!market.live && <span className="ah-q">prices from 5 Nov 2026</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

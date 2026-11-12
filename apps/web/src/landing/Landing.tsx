// nyxeron.xyz: the landing. Scrolling the page is one night out, from the street door to closing time; DESIGN.md has
// the concept, the system and the references (MotionSites "Freight Scroll Hero", our earlier NYXERON landing).
// Light on purpose: no three.js or Privy here, clips load after the page and only near the screen.
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react'
import { setMuted, useMusicState } from '../audio/music.ts'
import { Mark } from '../Mark.tsx'
import { BarFigure } from './BarFigure.tsx'
import { appUrl } from '../site.ts'
import './landing.css'
import { startLanding } from './motion.ts'

const BEATS = [
  {
    at: '22:30',
    label: 'The host is in',
    side: 'l',
    title: 'The CEO opens the club.',
    text: 'Host a party, price every drink between wholesale and 3×, keep the margin.',
  },
  {
    at: '23:00',
    label: 'Guests arrive',
    side: 'r',
    title: 'Guests buy at the bar.',
    text: 'Sign in with Google or email and pay in dollars. No wallet pop-up, no gas.',
  },
  {
    at: '23:30',
    label: 'Going down',
    side: 'c',
    title: 'Down the stairs.',
    text: 'Below: a dance floor, a bar, and a menu of real stocks at live prices.',
  },
] as const

/** Where a part of the page sits in the night: the clock in the top bar runs between these. */
function Stamp({ at, label }: { at: string; label: string }) {
  return (
    <p className="stamp">
      {at} · {label}
    </p>
  )
}

const NUMBERS = [
  { n: 0.001, dp: 3, unit: 'share', text: 'of a real stock in every drink you buy' },
  { n: 10, dp: 0, unit: 'stocks', text: 'on the menu, Tesla to the S&P 500, at live prices' },
  { n: 3, dp: 0, unit: '× wholesale', text: 'the most a host can charge; the contract refuses more' },
  { n: 0, dp: 0, unit: 'pop-ups', text: 'no wallet, no seed phrase, no gas to pay' },
]

const STOPS = [
  {
    title: 'Sign in',
    tech: 'Privy · NEAR account',
    text: 'Google or email gives you a NEAR account of your own. Nothing to install, no seed phrase to keep.',
  },
  {
    title: 'Order',
    tech: 'NEP-366 meta-transaction',
    text: 'You sign the payment and our relayer pays the gas. The dollars move as USDC, with a price quote our server signed.',
  },
  {
    title: 'Split',
    tech: 'nyxeron contract',
    text: 'The contract checks the quote, sends the margin to the host and the wholesale to the treasury. A bad quote comes back to you whole.',
  },
  {
    title: 'Settle',
    tech: 'Chain Signatures · NEP-245',
    text: 'When the party ends, a NEAR account buys the stock tokens on Robinhood Chain and your units arrive. On testnet that purchase is simulated.',
  },
]

const DOORS = [
  {
    path: '/practice',
    title: 'Practice',
    meta: 'No sign-in',
    text: 'Run The Basement for a night with play money.',
    img: '/landing/door-practice.webp',
  },
  {
    path: '/city',
    title: 'City',
    meta: 'Testnet dollars',
    text: 'Host as CEO or go out as a guest, for real.',
    img: '/landing/door-city.webp',
  },
  {
    path: '/proof',
    title: 'Proof',
    meta: 'On chain',
    text: 'Every unit and every party, checked on NEAR.',
    img: '/landing/door-proof.webp',
  },
]

const FAQ = [
  {
    q: 'What is NYXERON?',
    a: 'A nightclub game on NEAR. A host opens a party and sets the drink prices. Guests buy drinks, and every drink holds 0.001 of a real share that the guest keeps.',
  },
  {
    q: 'Is it real money?',
    a: 'Not yet. The live game runs on NEAR testnet with test dollars you can get once a day. The mainnet purchase of real shares is built and waits for its first run.',
  },
  {
    q: 'Do I need a wallet?',
    a: 'No. Sign in with Google or email and you get your own NEAR account. No seed phrase, no wallet pop-up, no gas.',
  },
  {
    q: 'What do I own?',
    a: 'For every drink, 0.001 of a real share, held as NEP-245 units in your own NEAR account. Three Tesla drinks are 0.003 of a Tesla share.',
  },
  {
    q: 'Where do the shares come from?',
    a: 'Robinhood stock tokens on Robinhood Chain, bought by an address that a NEAR account controls through Chain Signatures. The Proof page shows the units against the shares behind them.',
  },
  {
    q: 'How do I get my money out?',
    a: 'Cash out sends your dollars to almost any chain through NEAR Intents. Add money brings them in the same way.',
  },
  {
    q: 'Can I try it without an account?',
    a: 'Yes. Practice runs a full night with play money and live stock prices, no sign-in.',
  },
  { q: 'Is it open source?', a: 'Yes, under the MIT license.' },
]

/** A primary action: gold, filled from the pointer's side on hover. */
function Cta({ href, children, line }: { href: string; children: ReactNode; line?: boolean }) {
  return (
    <a href={href} className={line ? 'cta cta-line' : 'cta'} data-fill>
      <span className="fill" aria-hidden />
      <span className="cta-label">{children}</span>
    </a>
  )
}

/** Music on and off, with what is playing; the choice is remembered. */
function MusicSwitch() {
  const { muted, title, playing } = useMusicState()
  const on = playing && !muted
  const text = on ? title || 'NYXERON Lounge' : muted ? 'Music off' : 'Play music'
  return (
    <button
      type="button"
      className={`music ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      // The visible text first (it hides on phones), then what the switch does.
      aria-label={`${text}, music ${on ? 'on' : 'off'}`}
      // Before the first tap nothing plays yet: this tap starts it instead of muting it.
      onClick={() => setMuted(on)}
    >
      <span className="eq" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="music-title">{text}</span>
      <span className="music-short" aria-hidden>
        {on ? 'On' : 'Music'}
      </span>
    </button>
  )
}

function TopBar() {
  return (
    <header className="bar" data-bar>
      <a href="#main" className="brand" aria-label="NYXERON, back to the top">
        <Mark className="size-7 text-neon" />
        <span>Nyxeron</span>
      </a>
      <p className="clock" aria-hidden>
        <span data-clock>22:00</span>
        <span className="clock-label" data-clock-label>
          Doors open
        </span>
      </p>
      <div className="bar-end">
        <MusicSwitch />
        <a href={appUrl('/')} className="bar-cta">
          Launch app
        </a>
      </div>
    </header>
  )
}

/** The signature: the street door and the stairs down, scrubbed by the scroll; the night's beats on its axis. */
function Descent() {
  return (
    <section className="track" data-track aria-labelledby="title">
      <div className="scene">
        <video
          muted
          playsInline
          preload="none"
          poster="/landing/stairs.webp"
          data-hd="/landing/stairs-hd.mp4"
          data-sd="/landing/stairs-sd.mp4"
          aria-hidden
        />
        <div className="scene-tint" />
        <div className="scene-light" />
      </div>
      <div className="track-content">
        <div className="intro" data-at="22:00" data-label="Doors open">
          <h1 id="title" className="wordmark">
            Nyxeron<span className="sr-only">: a nightclub on NEAR where every drink is a real share</span>
          </h1>
          <div className="intro-row">
            <p className="intro-line">
              Run a nightclub where every drink is a <em>real share</em>.
            </p>
            <div className="intro-actions">
              <Cta href={appUrl('/')}>Launch app</Cta>
              <Cta href={appUrl('/practice')} line>
                Play the demo · no sign-in
              </Cta>
            </div>
          </div>
          <p className="cue" aria-hidden>
            Scroll to go in
          </p>
        </div>
        {BEATS.map((b) => (
          <article key={b.at} className={`beat beat-${b.side}`} data-reveal data-at={b.at} data-label={b.label}>
            <p className="beat-at">{b.at}</p>
            <h2 className="beat-title">{b.title}</h2>
            <p className="beat-text">{b.text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function Floor() {
  return (
    <section className="floor" aria-labelledby="floor-title" data-at="00:30" data-label="On the floor">
      <video
        className="floor-clip"
        muted
        loop
        playsInline
        preload="none"
        poster="/landing/reveal.webp"
        data-loop
        data-src="/landing/reveal.mp4"
        aria-hidden
      />
      <div className="floor-shade" />
      <div className="floor-in">
        <div data-reveal>
          <Stamp at="00:30" label="On the floor" />
          <h2 id="floor-title" className="floor-title">
            Every drink on the menu is a <em>real stock</em>.
          </h2>
        </div>
        <ul className="numbers">
          {NUMBERS.map((n) => (
            <li key={n.unit} data-reveal>
              <p className="num">
                <span data-count={n.n} data-dp={n.dp}>
                  {n.n.toFixed(n.dp)}
                </span>
                <span className="num-unit">{n.unit}</span>
              </p>
              <p className="num-text">{n.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Flow() {
  // The stop in the middle of the screen (or under the pointer) is the one the figure plays.
  const active = useRef(-1)
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const items = [...list.current!.children] as HTMLElement[]
    const pick = (i: number) => {
      active.current = i
      items.forEach((li, j) => li.classList.toggle('is-active', i === j))
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && pick(items.indexOf(e.target as HTMLElement))),
      { rootMargin: '-45% 0px -45% 0px' },
    )
    const off = items.map((li, i) => {
      io.observe(li)
      const on = () => pick(i)
      li.addEventListener('pointerenter', on)
      return () => li.removeEventListener('pointerenter', on)
    })
    return () => {
      io.disconnect()
      off.forEach((f) => f())
    }
  }, [])
  return (
    <section className="flow" aria-labelledby="flow-title" data-at="01:30" data-label="At the bar">
      <div className="flow-head">
        <div>
          <Stamp at="01:30" label="At the bar" />
          <h2 id="flow-title" className="display-2" data-reveal>
            One drink, four stops.
          </h2>
        </div>
        <p className="lede" data-reveal>
          What happens on NEAR between tapping Buy and holding the share. Money comes in and goes out from any chain
          through NEAR Intents.
        </p>
      </div>
      <div className="flow-body">
        <div className="flow-fig">
          <BarFigure active={active} />
        </div>
        <ol className="stops" ref={list}>
          {STOPS.map((s, i) => (
            <li key={s.title} className="stop" data-reveal style={{ '--i': i } as CSSProperties}>
              <span className="stop-n" aria-hidden>
                {i + 1}
              </span>
              <div>
                <h3 className="stop-title">{s.title}</h3>
                <p className="stop-tech">{s.tech}</p>
                <p className="stop-text">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Doors() {
  return (
    <section className="doors" aria-labelledby="doors-title" data-at="02:30" data-label="Pick a door">
      <Stamp at="02:30" label="Pick a door" />
      <h2 id="doors-title" className="display-2" data-reveal>
        Three ways in.
      </h2>
      <ul className="door-list" data-doors>
        {DOORS.map((d) => (
          <li key={d.path}>
            <a href={appUrl(d.path)} className="door" data-peek-src={d.img}>
              <span className="door-title">{d.title}</span>
              <span className="door-meta">{d.meta}</span>
              <span className="door-text">{d.text}</span>
              <span className="door-arrow" aria-hidden>
                →
              </span>
              <img className="door-thumb" src={d.img} alt="" loading="lazy" width={900} height={506} />
            </a>
          </li>
        ))}
      </ul>
      <div className="peek" data-peek aria-hidden>
        <img alt="" width={900} height={506} />
      </div>
    </section>
  )
}

function Faq() {
  return (
    <section className="faq" aria-labelledby="faq-title" data-at="03:00" data-label="At the door">
      <div className="faq-title">
        <Stamp at="03:00" label="At the door" />
        <h2 id="faq-title" className="display-2" data-reveal>
          Questions at the door.
        </h2>
      </div>
      <div className="faq-list">
        {FAQ.map((f) => (
          <details key={f.q} className="qa">
            <summary>
              <span>{f.q}</span>
              <span className="qa-mark" aria-hidden />
            </summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function LastCall() {
  return (
    <section className="last" aria-labelledby="last-title" data-at="03:30" data-label="Last call">
      <video
        className="last-clip"
        muted
        loop
        playsInline
        preload="none"
        poster="/landing/door-city.webp"
        data-loop
        data-src="/landing/intro.mp4"
        aria-hidden
      />
      <div className="last-shade" />
      <div className="last-in" data-reveal>
        <Stamp at="03:30" label="Last call" />
        <h2 id="last-title" className="display-1">
          Last call.
        </h2>
        <p className="lede">Live on NEAR testnet. No install, no wallet, two minutes to your first share.</p>
        <div className="intro-actions">
          <Cta href={appUrl('/')}>Launch app</Cta>
          <Cta href={appUrl('/practice')} line>
            Play the demo · no sign-in
          </Cta>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="foot">
      <div className="finale" data-at="04:00" data-label="Closing" data-reveal>
        <Stamp at="04:00" label="Closing" />
        <p className="display-2">The shares go home.</p>
        <p className="lede">
          When the party ends, every drink you bought lands in your own NEAR account as 0.001 of a real share.
        </p>
      </div>
      <div className="foot-cols">
        <nav aria-label="Play">
          <p className="foot-h">Play</p>
          <a href={appUrl('/')}>Launch app</a>
          <a href={appUrl('/practice')}>Practice</a>
          <a href={appUrl('/city')}>City</a>
        </nav>
        <nav aria-label="Check">
          <p className="foot-h">Check</p>
          <a href={appUrl('/proof')}>Proof</a>
          <a href="#faq-title">Questions</a>
        </nav>
        <div>
          <p className="foot-h">The night</p>
          <p>Built at NEAR HACKATHON 2026.</p>
          <p>Live on NEAR testnet.</p>
        </div>
      </div>
      <p className="sign" aria-hidden data-reveal>
        {[...'NYXERON'].map((c, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties}>
            {c}
          </span>
        ))}
      </p>
    </footer>
  )
}

export function Landing() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => startLanding(root.current!), [])
  return (
    <div ref={root} className="lp">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <TopBar />
      <main id="main">
        <Descent />
        <Floor />
        <Flow />
        <Doors />
        <Faq />
        <LastCall />
      </main>
      <Footer />
    </div>
  )
}

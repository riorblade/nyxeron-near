// nyxeron.xyz: the landing. Layout and motion after MotionSites' "Cinematic Landing Page" (a sticky hero whose next
// video opens in a growing ellipse as you scroll, a per-letter title, words that light up with the scroll) and "Mouse
// Trail CTA", without GSAP: scroll and IntersectionObserver only. The clips are from our earlier NYXERON landing.
// Light on purpose: no three.js or Privy here, videos load after the page and only near the screen.
import { tokens } from '@nyxeron/game'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { Mark } from '../Mark.tsx'
import { appUrl } from '../site.ts'
import './landing.css'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v: number) => Math.min(1, Math.max(0, v))
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

const STATEMENT =
  'Run a nightclub where every drink on the menu is a slice of a real share, and every guest takes theirs home.'

const STEPS = [
  {
    n: '01',
    title: 'The CEO opens the club',
    text: 'Host a party, set the drink prices between wholesale and 3×, pick the moves: happy hour, anthem, pyro.',
  },
  {
    n: '02',
    title: 'Guests buy at the bar',
    text: 'Sign in with Google or email, pay in dollars. No wallet pop-up, no seed phrase, no gas.',
  },
  {
    n: '03',
    title: 'The shares go home',
    text: 'Each drink is 0.001 of a real share. When the party ends, it lands in the guest’s own NEAR account.',
  },
]

const DOORS = [
  { path: '/practice', title: 'Practice', tag: 'No sign-in', text: 'Run The Basement for a night with play money.' },
  { path: '/city', title: 'City', tag: 'Testnet dollars', text: 'Host as CEO or go out as a guest, for real.' },
  { path: '/proof', title: 'Proof', tag: 'On chain', text: 'Every unit, every party, checked on chain.' },
]

const NEAR = [
  ['Privy NEAR accounts', 'Google or email sign-in, an account of your own'],
  ['NEP-366 meta-transactions', 'the player signs, our relayer pays the gas'],
  ['NEP-245 multi tokens', '1 unit = 0.001 share, on our contract'],
  ['Chain Signatures', 'a NEAR account buys the stock tokens'],
  ['NEAR Intents', 'money in and out from any chain'],
]

const TICKERS = Object.values(tokens).map((t) => t.ticker)

/** Resolves once the page has loaded and settled, so clips never compete with what the first screen needs. */
const settled = new Promise<void>((done) => {
  const go = () => setTimeout(done, 1200)
  if (document.readyState === 'complete') go()
  else addEventListener('load', go, { once: true })
})

/** A muted clip that loads after the page and plays only on screen; just its still under reduced motion. */
function Clip(props: { src: string; poster: string; className?: string; armed?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const armed = props.armed ?? true
  useEffect(() => {
    const v = ref.current!
    if (reduced() || !armed) return
    let alive = true
    let seen = false
    const io = new IntersectionObserver(
      ([e]) => {
        seen = Boolean(e?.isIntersecting)
        if (!seen) return v.pause()
        void settled.then(() => {
          if (!alive || !seen) return
          if (!v.src) v.src = props.src
          void v.play().catch(() => {})
        })
      },
      { rootMargin: '200px' },
    )
    io.observe(v)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [props.src, armed])
  return (
    <video
      ref={ref}
      className={props.className}
      poster={props.poster}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
    />
  )
}

/** Fades and lifts its children in once they come on screen. */
function Rise({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setOn(true), { threshold: 0.15 })
    io.observe(ref.current!)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={`rise ${on ? 'on' : ''} ${className}`} style={{ '--d': `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  )
}

/** The title, letter by letter, each lit like a neon tube warming up. */
function NeonTitle({ text }: { text: string }) {
  return (
    <h1 className="neon-title" aria-label={text}>
      {[...text].map((c, i) => (
        <span key={i} aria-hidden style={{ '--i': i } as CSSProperties}>
          {c}
        </span>
      ))}
    </h1>
  )
}

/** Hero: the door clip, then the dance floor opening in an ellipse as you scroll. */
function Hero() {
  const wrap = useRef<HTMLDivElement>(null)
  const floor = useRef<HTMLDivElement>(null)
  const [past, setPast] = useState(false)
  const [opening, setOpening] = useState(false)
  useEffect(() => {
    if (reduced()) return
    const update = () => {
      const w = wrap.current!
      const y = Math.max(0, scrollY - w.offsetTop)
      const p = clamp(y / (w.offsetHeight - innerHeight))
      const e = ease(clamp((p - 0.15) / 0.7))
      floor.current!.style.clipPath =
        e <= 0 ? 'ellipse(0% 0% at 50% 50%)' : `ellipse(${5 + e * 150}% ${8 + e * 150}% at 50% 50%)`
      setPast(p > 0.5)
      if (p > 0.02) setOpening(true)
    }
    update()
    addEventListener('scroll', update, { passive: true })
    addEventListener('resize', update)
    return () => {
      removeEventListener('scroll', update)
      removeEventListener('resize', update)
    }
  }, [])
  return (
    <div ref={wrap} className="hero-wrap">
      <section className="sticky top-0 h-dvh overflow-hidden">
        <Clip src="/landing/hero.mp4" poster="/landing/hero.webp" className="absolute inset-0 size-full object-cover" />
        <div ref={floor} className="floor absolute inset-0">
          <Clip
            src="/landing/reveal.mp4"
            poster="/landing/reveal.webp"
            className="size-full object-cover"
            armed={opening}
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-night/70 via-night/20 to-night" />
        <div className="relative flex h-full flex-col items-center justify-end px-4 pb-24 text-center sm:pb-20">
          <NeonTitle text="NYXERON" />
          <p className={`swap mt-3 text-lg font-semibold sm:text-2xl ${past ? 'is-b' : ''}`}>
            <span className="a">Run a nightclub on NEAR.</span>
            <span className="b">
              Every drink is a <span className="text-gold">real share</span>.
            </span>
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a href={appUrl('/')} className="btn-gold">
              Launch app
            </a>
            <a href={appUrl('/practice')} className="btn-line">
              Play the demo · no sign-in
            </a>
          </div>
          <p className="mt-8 text-xs tracking-[0.3em] text-muted uppercase" aria-hidden>
            Scroll to go in ↓
          </p>
        </div>
      </section>
    </div>
  )
}

/** One sentence whose words light up as it scrolls through the screen. */
function Statement() {
  const ref = useRef<HTMLParagraphElement>(null)
  const words = STATEMENT.split(' ')
  useEffect(() => {
    const el = ref.current!
    const spans = [...el.querySelectorAll<HTMLElement>('.statement-word')]
    if (reduced()) return spans.forEach((s) => (s.style.opacity = '1'))
    const update = () => {
      const r = el.getBoundingClientRect()
      const p = clamp((innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35))
      spans.forEach((s, i) => {
        const w = clamp(p * words.length - i)
        s.style.opacity = String(0.15 + 0.85 * w)
        s.style.filter = `blur(${(1 - w) * 4}px)`
      })
    }
    update()
    addEventListener('scroll', update, { passive: true })
    return () => removeEventListener('scroll', update)
  }, [words.length])
  return (
    <section className="mx-auto max-w-4xl px-4 py-28 sm:py-40">
      <p ref={ref} className="text-center text-3xl leading-tight font-bold sm:text-5xl">
        <span className="sr-only">{STATEMENT}</span>
        {words.map((w, i) => (
          <span key={i} aria-hidden className="statement-word">
            {w}{' '}
          </span>
        ))}
      </p>
    </section>
  )
}

/** The last call: the club's intro clip, and on a mouse, a trail of the menu's tickers following the cursor. */
function LastCall() {
  const card = useRef<HTMLDivElement>(null)
  const [trail, setTrail] = useState<{ id: number; x: number; y: number; t: string; r: number; at: number }[]>([])
  const last = useRef(0)
  const id = useRef(0)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!trail.length) return
    const iv = setInterval(() => {
      const t = Date.now()
      setNow(t)
      setTrail((tr) => tr.filter((x) => t - x.at < 1000))
    }, 50)
    return () => clearInterval(iv)
  }, [trail.length])
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || reduced() || Date.now() - last.current < 80) return
    last.current = Date.now()
    const r = card.current!.getBoundingClientRect()
    const t = TICKERS[Math.floor(Math.random() * TICKERS.length)]!
    setTrail((tr) => [
      ...tr,
      {
        id: id.current++,
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        t,
        r: (Math.random() - 0.5) * 20,
        at: Date.now(),
      },
    ])
  }
  return (
    <section className="px-4 pb-24">
      <div
        ref={card}
        onPointerMove={onMove}
        className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-line"
      >
        <Clip
          src="/landing/intro.mp4"
          poster="/landing/intro.webp"
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-night/70" />
        <div className="relative z-10 flex flex-col items-center px-6 py-28 text-center sm:py-40">
          <Rise>
            <h2 className="text-4xl font-bold sm:text-6xl">
              The club is <span className="neon-text">open</span>.
            </h2>
          </Rise>
          <Rise delay={120}>
            <p className="mt-4 max-w-md text-muted">Live on NEAR testnet. No install, no wallet, two minutes.</p>
          </Rise>
          <Rise delay={240}>
            <a href={appUrl('/')} className="btn-gold mt-8 inline-block">
              Launch app
            </a>
          </Rise>
        </div>
        {trail.map((x) => {
          const p = Math.min((now - x.at) / 1000, 1)
          return (
            <span
              key={x.id}
              aria-hidden
              className="trail"
              style={{
                left: x.x,
                top: x.y,
                opacity: 1 - Math.max(0, p),
                transform: `translate(-50%, -50%) scale(${1 - Math.max(0, p) * 0.15}) rotate(${x.r}deg)`,
              }}
            >
              {x.t} <span className="text-gold">0.001</span>
            </span>
          )
        })}
      </div>
    </section>
  )
}

export function Landing() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(scrollY > 50)
    on()
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])

  return (
    <div className="landing overflow-x-clip">
      <header className={`nav ${scrolled ? 'is-scrolled' : ''}`}>
        <a href="#top" className="flex items-center gap-2 text-sm font-bold tracking-[0.3em] uppercase">
          <Mark className="size-7 text-neon" />
          Nyxeron
        </a>
        <a href={appUrl('/')} className="btn-gold btn-sm">
          Launch app
        </a>
      </header>

      <main id="top">
        <Hero />
        <Statement />

        <section className="mx-auto max-w-6xl px-4 py-16">
          <Rise>
            <h2 className="kicker">How a night works</h2>
          </Rise>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Rise key={s.n} delay={i * 120} className="h-full">
                <article className="card h-full">
                  <p className="font-mono text-sm text-neon">{s.n}</p>
                  <h3 className="mt-3 text-xl font-bold">{s.title}</h3>
                  <p className="mt-2 text-muted">{s.text}</p>
                </article>
              </Rise>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <Rise>
            <h2 className="kicker">Three ways in</h2>
          </Rise>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {DOORS.map((d, i) => (
              <Rise key={d.path} delay={i * 120} className="h-full">
                <a href={appUrl(d.path)} className="card door group block h-full">
                  <span className="text-xs tracking-widest text-gold uppercase">{d.tag}</span>
                  <span className="mt-3 flex items-center justify-between text-2xl font-bold">
                    {d.title}
                    <span className="transition-transform group-hover:translate-x-1" aria-hidden>
                      →
                    </span>
                  </span>
                  <span className="mt-2 block text-muted">{d.text}</span>
                </a>
              </Rise>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <Rise>
            <p className="kicker">Built on NEAR</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold sm:text-4xl">
              The blockchain does the work. The player just orders a drink.
            </h2>
          </Rise>
          <ul className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
            {NEAR.map(([name, what], i) => (
              <li key={name} className="bg-night">
                <Rise delay={i * 80} className="h-full p-5">
                  <p className="font-semibold">{name}</p>
                  <p className="mt-1 text-sm text-muted">{what}</p>
                </Rise>
              </li>
            ))}
          </ul>
        </section>

        <LastCall />
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-line px-4 pt-8 pb-20 text-sm text-muted">
        <p className="flex items-center gap-2">
          <Mark className="size-5" /> NYXERON · built at NEAR HACKATHON 2026
        </p>
        <nav className="flex gap-5">
          <a className="hover:text-ink" href={appUrl('/proof')}>
            Proof
          </a>
          <a
            className="hover:text-ink"
            href="https://github.com/riorblade/nyxeron-near"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </footer>
    </div>
  )
}

// app.nyxeron.xyz's home: pick how to play.
import { Mark } from '../Mark.tsx'
import { Link } from '../router.tsx'

const CARDS = [
  {
    href: '/practice',
    title: 'Practice',
    tag: 'No sign-in',
    text: 'Run The Basement for a night with play money and live stock prices. Fast-forward a week to test your menu.',
  },
  {
    href: '/city',
    title: 'City',
    tag: 'Real dollars · testnet',
    text: 'Sign in as a CEO to throw a party and keep the margin, or as a guest to buy drinks that are slices of real shares.',
  },
  {
    href: '/proof',
    title: 'Proof',
    tag: 'On chain',
    text: 'The contract, the dollar token and every stock the menu sells, checked on chain.',
  },
]

export function AppHome() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-4 py-12">
      <a
        href="https://nyxeron.xyz"
        className="flex items-center gap-3 text-sm font-semibold tracking-[0.3em] text-neon uppercase"
      >
        <Mark className="size-8 text-ink" />
        Nyxeron
      </a>
      <h1 className="mt-4 text-3xl font-bold sm:text-4xl">Where to tonight?</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="flex flex-col rounded-2xl border border-line bg-panel p-5 transition hover:border-gold"
          >
            <span className="text-xs font-semibold tracking-wide text-gold uppercase">{c.tag}</span>
            <span className="mt-1 text-xl font-bold">{c.title}</span>
            <span className="mt-2 text-sm text-muted">{c.text}</span>
          </Link>
        ))}
      </div>
    </main>
  )
}

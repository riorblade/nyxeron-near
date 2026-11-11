import { Mark } from '../Mark.tsx'
import { appUrl } from '../site.ts'

export function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-12">
      <p className="flex items-center gap-3 text-sm font-semibold tracking-[0.3em] text-neon uppercase">
        <Mark className="size-10 text-ink" />
        Nyxeron
      </p>
      <h1 className="mt-3 text-4xl leading-tight font-bold sm:text-5xl">
        Run a nightclub where every drink is a <span className="text-gold">real share</span>.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        Set the prices, pick the DJ, read the crowd. A Tesla on the menu is 0.001 of a Tesla share, and the guests who
        buy it take the share home.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href={appUrl('/')} className="rounded-xl bg-gold px-6 py-3 font-bold text-night hover:brightness-110">
          Launch app
        </a>
        <a
          href={appUrl('/practice')}
          className="rounded-xl border border-line px-6 py-3 font-semibold hover:border-violet"
        >
          Play the demo · no sign-in
        </a>
      </div>
      <ul className="mt-12 grid gap-4 text-sm text-muted sm:grid-cols-3">
        <li>
          <span className="block font-semibold text-ink">Practice</span>A full night in five minutes with play money and
          live stock prices.
        </li>
        <li>
          <span className="block font-semibold text-ink">Fast-forward</span>A week of nights in a second, to test your
          menu.
        </li>
        <li>
          <span className="block font-semibold text-ink">City</span>Real parties, real dollars, real shares.
        </li>
      </ul>
    </main>
  )
}

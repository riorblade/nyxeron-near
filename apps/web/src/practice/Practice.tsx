// Practice: the club dashboard before the doors open, the party live (one game minute a second), the night report
// and a fast-forward week. No login, no wallet, play money: the whole night runs in the browser from @nyxeron/game.
import {
  type Genre,
  happyHourOn,
  type Night,
  type NightEvent,
  type NightReport,
  report,
  rules,
  SHARES_PER_UNIT,
  tokens,
  venueFor,
} from '@nyxeron/game'
import { lazy, Suspense } from 'react'
import { clock, usd } from '../format.ts'
import { Link } from '../router.tsx'
import { MenuBoard } from './MenuBoard.tsx'
import { usePractice } from './usePractice.ts'

// three.js is big: the 3D club loads with Practice's first render, not with the landing page.
const Venue = lazy(() => import('../venue/Venue.tsx').then((m) => ({ default: m.Venue })))
const VenuePicker = lazy(() => import('../venue/VenuePicker.tsx').then((m) => ({ default: m.VenuePicker })))

const GENRES = Object.keys(rules.DJ_ENERGY) as Genre[]

export function Practice() {
  const p = usePractice()
  const { night, source, career } = p
  if (!night || !source) return <p className="p-6 text-muted">Opening the club…</p>
  const venue = venueFor(career.reputation)

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-muted hover:text-ink">
            ← NYXERON
          </Link>
          <h1 className="text-2xl font-bold">
            Practice club <span className="text-sm font-normal text-muted">play money</span>
          </h1>
        </div>
        <dl className="flex gap-5 text-sm">
          <Stat label="Venue" value={`Level ${venue.level} · ${venue.capacity} guests`} />
          <Stat label="Reputation" value={career.reputation.toFixed(1)} />
          <Stat label="Nights" value={String(career.nights)} />
          <Stat label="Margin so far" value={usd(career.margin)} />
        </dl>
      </header>

      {!source.live && (
        <p className="mb-4 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
          Live prices are unavailable, so tonight uses sample prices from 5 Nov 2026.
        </p>
      )}
      {p.refusal && (
        <p role="alert" className="mb-4 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
          {p.refusal}
        </p>
      )}

      {p.phase === 'club' && (
        <div className="mb-4">
          <Suspense fallback={<div className="h-[70vh] min-h-96 rounded-2xl border border-line bg-panel" />}>
            <VenuePicker reputation={career.reputation} onOpen={p.open} />
          </Suspense>
        </div>
      )}
      {p.phase === 'party' && (
        <div className="mb-4 h-[60vh] min-h-80 overflow-hidden rounded-2xl border border-line">
          <Suspense fallback={null}>
            <Venue level={levelOf(night.capacity)} night={night} />
          </Suspense>
        </div>
      )}

      {p.phase === 'report' ? (
        <ReportView r={report(night)} onNext={p.nextNight} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_22rem]">
          <MenuBoard night={night} onPrice={p.price} />
          <div className="order-first flex flex-col gap-4 md:order-none">
            <Controls night={night} live={p.phase === 'party'} dj={p.dj} happyHour={p.happyHour} />
            {p.phase === 'club' ? (
              <section className="rounded-2xl border border-line bg-panel p-4">
                <button
                  onClick={p.previewWeek}
                  className="w-full rounded-xl border border-line py-2 text-sm hover:border-violet"
                >
                  Fast-forward a week with this menu
                </button>
                <button onClick={p.resetCareer} className="mt-3 w-full text-xs text-muted hover:text-ink">
                  Start a new career
                </button>
              </section>
            ) : (
              <Party night={night} speed={p.speed} setSpeed={p.setSpeed} finish={p.finishNight} />
            )}
          </div>
        </div>
      )}

      {p.week && <WeekView reports={p.week} onClose={p.closeWeek} />}
    </main>
  )
}

const levelOf = (capacity: number) => rules.VENUES.find((v) => v.capacity === capacity)?.level ?? 1

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Controls(props: { night: Night; live: boolean; dj: (g: Genre) => void; happyHour: () => void }) {
  const { night } = props
  const hh = happyHourOn(night)
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">DJ</h2>
      <div className="flex flex-wrap gap-2">
        {GENRES.map((g) => (
          <button
            key={g}
            onClick={() => props.dj(g)}
            className={`rounded-full border px-3 py-1 text-sm capitalize ${
              night.dj === g ? 'border-neon bg-neon/15 text-ink' : 'border-line text-muted hover:text-ink'
            }`}
          >
            {g}
          </button>
        ))}
      </div>
      {props.live && (
        <button
          onClick={props.happyHour}
          disabled={night.happyHourFrom !== null}
          className="mt-3 w-full rounded-xl border border-violet py-2 text-sm font-semibold disabled:opacity-50"
        >
          {hh
            ? `Happy hour on · until ${clock(night.happyHourFrom! + rules.HAPPY_HOUR_MINUTES)}`
            : night.happyHourFrom !== null
              ? 'Happy hour used'
              : `Happy hour · −${rules.HAPPY_HOUR_DISCOUNT * 100} % for ${rules.HAPPY_HOUR_MINUTES} min`}
        </button>
      )}
    </section>
  )
}

function Party(props: { night: Night; speed: number; setSpeed: (s: number) => void; finish: () => void }) {
  const n = props.night
  const sales = Object.values(n.sales)
  const revenue = sales.reduce((a, s) => a + s.revenue, 0)
  const margin = sales.reduce((a, s) => a + s.margin, 0)
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-bold tabular-nums">{clock(n.minute)}</span>
        <span className="text-sm text-muted">
          {n.guests.length}/{n.capacity} inside
        </span>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Energy</span>
          <span className="tabular-nums">{Math.round(n.energy)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-gradient-to-r from-violet to-neon transition-[width] duration-700"
            style={{ width: `${n.energy}%` }}
          />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Stat label="Served" value={`${n.served}/${n.came}`} />
        <Stat label="Sales" value={usd(revenue)} />
        <Stat label="Margin" value={usd(margin)} />
      </dl>
      <div className="mt-3 flex gap-2 text-xs">
        {[1, 5, 20].map((s) => (
          <button
            key={s}
            onClick={() => props.setSpeed(s)}
            className={`rounded-full border px-3 py-1 ${props.speed === s ? 'border-neon' : 'border-line text-muted'}`}
          >
            {s}×
          </button>
        ))}
        <button onClick={props.finish} className="ml-auto text-muted hover:text-ink">
          Skip to closing
        </button>
      </div>
      <Feed log={n.log} />
    </section>
  )
}

const FEED_STYLE: Record<NightEvent['kind'], string> = {
  buy: 'text-up',
  pass: 'text-muted',
  arrive: 'text-muted',
  leave: 'text-muted',
  ceo: 'text-gold',
}

function describe(e: NightEvent): string {
  switch (e.kind) {
    case 'buy':
      return `Guest ${e.guest} bought ${tokens[e.token].ticker} for ${usd(e.price)}: ${e.reason}`
    case 'pass':
      return `Guest ${e.guest} passed: ${e.reason}`
    case 'arrive':
      return `Guest ${e.guest} came in`
    case 'leave':
      return `Guest ${e.guest} left: ${e.reason}`
    case 'ceo':
      return e.reason
  }
}

function Feed({ log }: { log: NightEvent[] }) {
  const shown = log
    .filter((e) => e.kind !== 'arrive')
    .slice(-30)
    .reverse()
  return (
    <ol aria-live="polite" className="mt-3 max-h-72 space-y-1 overflow-y-auto border-t border-line pt-3 text-xs">
      {shown.length === 0 && <li className="text-muted">The first guests are on their way.</li>}
      {shown.map((e, i) => (
        <li key={`${e.minute}-${i}`} className={FEED_STYLE[e.kind]}>
          <span className="mr-2 text-muted tabular-nums">{clock(e.minute)}</span>
          {describe(e)}
        </li>
      ))}
    </ol>
  )
}

function ReportView({ r, onNext }: { r: NightReport; onNext: () => void }) {
  const rows = Object.entries(r.sales).sort((a, b) => b[1].units - a[1].units)
  const repDelta = r.reputationAfter - r.reputationBefore
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-line bg-panel p-6">
      <h2 className="text-xl font-bold">Night report</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Sales" value={usd(r.revenue)} />
        <Stat label="Your margin" value={usd(r.margin)} />
        <Stat label="Drinks" value={String(r.units)} />
        <Stat label="Guests served" value={`${r.guestsServed}/${r.guestsCame}`} />
        <Stat label="Avg energy" value={String(r.avgEnergy)} />
        <Stat label="Peak energy" value={String(r.peakEnergy)} />
        <Stat
          label="Reputation"
          value={`${r.reputationAfter.toFixed(1)} (${repDelta >= 0 ? '+' : '−'}${Math.abs(repDelta).toFixed(1)})`}
        />
        <Stat label="Best seller" value={r.bestSeller ? tokens[r.bestSeller].ticker : '—'} />
      </dl>
      {rows.length > 0 && (
        <table className="mt-5 w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-normal">Drink</th>
              <th className="py-1 text-right font-normal">Sold</th>
              <th className="py-1 text-right font-normal">Sales</th>
              <th className="py-1 text-right font-normal">Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, s]) => (
              <tr key={id} className="border-t border-line tabular-nums">
                <td className="py-1">{tokens[id as keyof typeof tokens].ticker}</td>
                <td className="py-1 text-right">{s.units}</td>
                <td className="py-1 text-right">{usd(s.revenue)}</td>
                <td className="py-1 text-right">{usd(s.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.units > 0 && (
        <p className="mt-4 text-sm text-muted">
          In the City these {r.units} drinks would be {(r.units * SHARES_PER_UNIT).toFixed(3)} real shares, collected by
          the guests after the party.
        </p>
      )}
      <button
        onClick={onNext}
        className="mt-5 w-full rounded-xl bg-gold py-3 font-bold text-night hover:brightness-110"
      >
        Next night
      </button>
    </section>
  )
}

function WeekView({ reports, onClose }: { reports: NightReport[]; onClose: () => void }) {
  const total = reports.reduce((a, r) => a + r.margin, 0)
  const last = reports.at(-1)
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-night/80 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-label="A week in fast-forward"
        className="w-full max-w-xl rounded-2xl border border-line bg-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold">A week in fast-forward</h2>
        <p className="mt-1 text-sm text-muted">Seven nights with tonight's menu and DJ. Your career doesn't change.</p>
        <table className="mt-4 w-full text-sm tabular-nums">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-normal">Night</th>
              <th className="py-1 text-right font-normal">Guests</th>
              <th className="py-1 text-right font-normal">Drinks</th>
              <th className="py-1 text-right font-normal">Margin</th>
              <th className="py-1 text-right font-normal">Reputation</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{i + 1}</td>
                <td className="py-1 text-right">{r.guestsCame}</td>
                <td className="py-1 text-right">{r.units}</td>
                <td className="py-1 text-right">{usd(r.margin)}</td>
                <td className="py-1 text-right">{r.reputationAfter.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 font-semibold">
          Week margin {usd(total)}
          {last && ` · venue level ${last.levelAfter} by the end`}
        </p>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-line py-2 text-sm hover:border-violet"
        >
          Back to the club
        </button>
      </section>
    </div>
  )
}

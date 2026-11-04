import { describe, expect, it } from 'vitest'
import { MAX_MARKUP } from './menu.ts'
import {
  fastForward,
  type Market,
  type Night,
  priceNow,
  runNight,
  setDj,
  setPrice,
  startHappyHour,
  startNight,
  tick,
  venueFor,
} from './night.ts'
import * as R from './rules.ts'

// Market prices as the api served them on 2026-11-04.
const market: Market = {
  tsla: { priceUsd: 375.21, change24h: -7.08 },
  nvda: { priceUsd: 206.7, change24h: 0.54 },
  aapl: { priceUsd: 336.88, change24h: 3.74 },
  spy: { priceUsd: 761.7, change24h: 1.18 },
  crcl: { priceUsd: 73.01, change24h: 0.39 },
}
const base = { seed: 42, reputation: 40, market }
const seeds = Array.from({ length: 30 }, (_, i) => 1000 + i)
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function play(n: Night, minutes = R.NIGHT_MINUTES): Night[] {
  const states = [n]
  for (let i = 0; i < minutes; i++) states.push(tick(states.at(-1)!))
  return states
}

describe('a night', () => {
  it('replays identically from the same seed, and differently from another', () => {
    const a = runNight(base)
    const b = runNight(base)
    expect(b.report).toEqual(a.report)
    expect(b.night.log).toEqual(a.night.log)
    expect(runNight({ ...base, seed: 43 }).report).not.toEqual(a.report)
  })

  it('never breaks its bounds, minute by minute', () => {
    for (const s of play(startNight(base))) {
      expect(s.energy).toBeGreaterThanOrEqual(0)
      expect(s.energy).toBeLessThanOrEqual(100)
      expect(s.guests.length).toBeLessThanOrEqual(s.capacity)
      for (const g of s.guests) expect(g.spent).toBeLessThanOrEqual(g.budget)
    }
  })

  it('sells only between wholesale and the 3× cap, and splits every sale into wholesale + margin', () => {
    const { night, report } = runNight(base, { markup: 2, happyHourAt: 100 })
    for (const e of night.log) {
      if (e.kind !== 'buy') continue
      const item = night.menu[e.token]!
      expect(e.price).toBeGreaterThanOrEqual(item.wholesale)
      expect(e.price).toBeLessThanOrEqual(item.wholesale * MAX_MARKUP)
    }
    expect(report.units).toBeGreaterThan(0)
    expect(report.revenue).toBe(report.wholesale + report.margin)
    expect(report.margin).toBeGreaterThanOrEqual(0)
  })

  it('gives every buy and every pass a reason a player can read', () => {
    const { night } = runNight(base, { markup: 2.9 })
    const decisions = night.log.filter((e) => e.kind === 'buy' || e.kind === 'pass')
    expect(decisions.length).toBeGreaterThan(0)
    for (const e of decisions) expect('reason' in e && e.reason.length > 5).toBe(true)
    expect(night.log.some((e) => e.kind === 'pass' && /too steep/.test(e.reason))).toBe(true)
  })

  it('ends after 300 minutes and stays ended', () => {
    const end = play(startNight(base), R.NIGHT_MINUTES + 5).at(-1)!
    expect(end.minute).toBe(R.NIGHT_MINUTES)
  })
})

describe('CEO actions', () => {
  const n = startNight(base)
  const w = n.menu.tsla!.wholesale

  it('price must stay between wholesale and 3× wholesale', () => {
    expect(setPrice(n, 'tsla', w - 1)).toEqual({ ok: false, reason: 'below_wholesale' })
    expect(setPrice(n, 'tsla', w * MAX_MARKUP + 1)).toEqual({ ok: false, reason: 'above_cap' })
    expect(setPrice(n, 'qqq', w)).toEqual({ ok: false, reason: 'unknown_token' })
    const r = setPrice(n, 'tsla', w * 2)
    expect(r.ok && r.night.menu.tsla!.price).toBe(w * 2)
    expect(n.menu.tsla!.price).not.toBe(w * 2) // the old state is untouched
  })

  it('happy hour: once a night, −20 % but never below wholesale', () => {
    const r1 = startHappyHour(n)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(priceNow(r1.night, 'tsla')).toBe(Math.round((n.menu.tsla!.price * 0.8) / 10_000) * 10_000)
    expect(startHappyHour(r1.night)).toEqual({ ok: false, reason: 'already_used' })
    const atWholesale = setPrice(n, 'tsla', w)
    if (!atWholesale.ok) throw new Error('setPrice failed')
    const hh = startHappyHour(atWholesale.night)
    expect(hh.ok && priceNow(hh.night, 'tsla')).toBe(w)
  })

  it('switching DJ costs energy at once; nothing works after closing', () => {
    const r = setDj(n, 'techno')
    expect(r.ok && r.night.energy).toBeCloseTo(Math.max(0, n.energy + R.ENERGY_DJ_SWITCH))
    const closed = play(n).at(-1)!
    expect(setDj(closed, 'pop')).toEqual({ ok: false, reason: 'night_over' })
    expect(startHappyHour(closed)).toEqual({ ok: false, reason: 'night_over' })
  })
})

describe('the economy behaves like one (averaged over 30 nights)', () => {
  it('cheaper drinks sell more, dearer drinks earn more per unit', () => {
    const cheap = seeds.map((seed) => runNight({ ...base, seed }, { markup: 1.1 }).report)
    const dear = seeds.map((seed) => runNight({ ...base, seed }, { markup: 2.8 }).report)
    expect(avg(cheap.map((r) => r.units))).toBeGreaterThan(avg(dear.map((r) => r.units)))
    expect(avg(dear.map((r) => r.margin / Math.max(1, r.units)))).toBeGreaterThan(
      avg(cheap.map((r) => r.margin / Math.max(1, r.units))),
    )
  })

  it('a stock that is up today outsells one that is down, at the same markup', () => {
    const twoStocks: Market = { aapl: { priceUsd: 300, change24h: 8 }, nvda: { priceUsd: 300, change24h: -8 } }
    const reports = seeds.map((seed) => runNight({ seed, reputation: 40, market: twoStocks }, { markup: 1.5 }).report)
    expect(avg(reports.map((r) => r.sales.aapl?.units ?? 0))).toBeGreaterThan(
      avg(reports.map((r) => r.sales.nvda?.units ?? 0)),
    )
  })

  it('happy hour lifts sales', () => {
    const without = seeds.map((seed) => runNight({ ...base, seed }, { markup: 2.5 }).report.units)
    const withHH = seeds.map((seed) => runNight({ ...base, seed }, { markup: 2.5, happyHourAt: 60 }).report.units)
    expect(avg(withHH)).toBeGreaterThan(avg(without))
  })

  it('a better reputation brings a bigger crowd', () => {
    const low = seeds.map((seed) => runNight({ ...base, seed, reputation: 5 }).report.guestsCame)
    const high = seeds.map((seed) => runNight({ ...base, seed, reputation: 80 }).report.guestsCame)
    expect(avg(high)).toBeGreaterThan(avg(low))
  })
})

describe('fast-forward and venues', () => {
  it('runs a week, carrying reputation from night to night, the same every time', () => {
    const week = fastForward({ ...base, nights: 7 }, { markup: 1.6, happyHourAt: 90 })
    expect(week).toHaveLength(7)
    for (let i = 1; i < week.length; i++) expect(week[i]!.reputationBefore).toBe(week[i - 1]!.reputationAfter)
    expect(fastForward({ ...base, nights: 7 }, { markup: 1.6, happyHourAt: 90 })).toEqual(week)
  })

  it('venue level follows reputation', () => {
    expect(venueFor(0).level).toBe(1)
    expect(venueFor(24.9).level).toBe(1)
    expect(venueFor(25).level).toBe(2)
    expect(venueFor(100).level).toBe(4)
    expect(startNight({ ...base, reputation: 60 }).capacity).toBe(100)
  })
})

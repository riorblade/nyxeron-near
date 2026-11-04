// One night at the club, as pure functions over a plain state object. tick() is one game minute.
import { MAX_MARKUP, type TokenId, tokenIds, tokens, wholesaleMicroUsdc } from './menu.ts'
import { between, next, type Rng, rng } from './rng.ts'
import * as R from './rules.ts'

const CENT = 10_000 // micro-USDC
const roundCent = (micro: number) => Math.round(micro / CENT) * CENT
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`

export type Market = Partial<Record<TokenId, { priceUsd: number; change24h: number }>>
export type MenuItem = { wholesale: number; price: number } // micro-USDC per unit (0.001 share)
export type Guest = { id: number; budget: number; spent: number }
export type NightEvent =
  | { minute: number; kind: 'arrive'; guest: number }
  | { minute: number; kind: 'leave'; guest: number; reason: string }
  | { minute: number; kind: 'buy'; guest: number; token: TokenId; price: number; reason: string }
  | { minute: number; kind: 'pass'; guest: number; token?: TokenId; reason: string }
  | { minute: number; kind: 'ceo'; reason: string }
export type Sales = { units: number; revenue: number; margin: number }

export type Night = {
  rng: Rng
  minute: number
  reputation: number
  capacity: number
  menu: Partial<Record<TokenId, MenuItem>>
  market: Market
  dj: R.Genre
  energy: number
  happyHourFrom: number | null
  guests: Guest[]
  nextGuest: number
  arrivalCarry: number
  came: number
  served: number[]
  sales: Partial<Record<TokenId, Sales>>
  energySum: number
  peakEnergy: number
  log: NightEvent[]
}

export type Refusal = 'unknown_token' | 'below_wholesale' | 'above_cap' | 'already_used' | 'night_over'
export type Result = { ok: true; night: Night } | { ok: false; reason: Refusal }

const LOG_KEEP = 400

export function venueFor(reputation: number) {
  return [...R.VENUES].reverse().find((v) => reputation >= v.reputation) ?? R.VENUES[0]
}

/** A new night. Every stock with a market price is on the menu at 1.5× wholesale until the CEO says otherwise. */
export function startNight(opts: { seed: number; reputation: number; market: Market; dj?: R.Genre }): Night {
  const menu: Night['menu'] = {}
  for (const id of tokenIds) {
    const m = opts.market[id]
    if (!m) continue
    const wholesale = wholesaleMicroUsdc(m.priceUsd)
    menu[id] = { wholesale, price: roundCent(wholesale * 1.5) }
  }
  const dj = opts.dj ?? 'house'
  return {
    rng: rng(opts.seed),
    minute: 0,
    reputation: clamp(opts.reputation, 0, 100),
    capacity: venueFor(opts.reputation).capacity,
    menu,
    market: opts.market,
    dj,
    energy: R.DJ_ENERGY[dj] * 0.6,
    happyHourFrom: null,
    guests: [],
    nextGuest: 1,
    arrivalCarry: 0,
    came: 0,
    served: [],
    sales: {},
    energySum: 0,
    peakEnergy: 0,
    log: [],
  }
}

const copy = (n: Night): Night => structuredClone(n)
const log = (n: Night, e: NightEvent) => {
  n.log.push(e)
  if (n.log.length > LOG_KEEP) n.log.splice(0, n.log.length - LOG_KEEP)
}

// ── CEO actions ──────────────────────────────────────────────────────────────────────────────────────────────────

export function setPrice(night: Night, token: TokenId, price: number): Result {
  const item = night.menu[token]
  if (!item) return { ok: false, reason: 'unknown_token' }
  if (price < item.wholesale) return { ok: false, reason: 'below_wholesale' }
  if (price > item.wholesale * MAX_MARKUP) return { ok: false, reason: 'above_cap' }
  const n = copy(night)
  n.menu[token] = { ...item, price: roundCent(price) }
  log(n, { minute: n.minute, kind: 'ceo', reason: `${tokens[token].ticker} now ${usd(n.menu[token]!.price)}` })
  return { ok: true, night: n }
}

export function startHappyHour(night: Night): Result {
  if (night.minute >= R.NIGHT_MINUTES) return { ok: false, reason: 'night_over' }
  if (night.happyHourFrom !== null) return { ok: false, reason: 'already_used' }
  const n = copy(night)
  n.happyHourFrom = n.minute
  n.energy = clamp(n.energy + R.HAPPY_HOUR_ENERGY, 0, 100)
  log(n, {
    minute: n.minute,
    kind: 'ceo',
    reason: `Happy hour: −${R.HAPPY_HOUR_DISCOUNT * 100} % for ${R.HAPPY_HOUR_MINUTES} min`,
  })
  return { ok: true, night: n }
}

export function setDj(night: Night, dj: R.Genre): Result {
  if (night.minute >= R.NIGHT_MINUTES) return { ok: false, reason: 'night_over' }
  const n = copy(night)
  if (dj !== n.dj) n.energy = clamp(n.energy + R.ENERGY_DJ_SWITCH, 0, 100)
  n.dj = dj
  log(n, { minute: n.minute, kind: 'ceo', reason: `DJ switches to ${dj}` })
  return { ok: true, night: n }
}

// ── What guests see ──────────────────────────────────────────────────────────────────────────────────────────────

export function happyHourOn(n: Night): boolean {
  return n.happyHourFrom !== null && n.minute >= n.happyHourFrom && n.minute < n.happyHourFrom + R.HAPPY_HOUR_MINUTES
}

/** What a drink costs right now (happy hour included), never below wholesale. */
export function priceNow(n: Night, token: TokenId): number | undefined {
  const item = n.menu[token]
  if (!item) return undefined
  return happyHourOn(n) ? Math.max(item.wholesale, roundCent(item.price * (1 - R.HAPPY_HOUR_DISCOUNT))) : item.price
}

/** How much a guest wants a drink, and why: 1 at wholesale falling to APPEAL_AT_MAX_MARKUP at 3×, × FOMO. */
export function appeal(n: Night, token: TokenId): { value: number; markup: number; change: number } | undefined {
  const item = n.menu[token]
  const m = n.market[token]
  const price = priceNow(n, token)
  if (!item || !m || price === undefined) return undefined
  const markup = price / item.wholesale
  const byPrice = 1 - ((markup - 1) / (MAX_MARKUP - 1)) * (1 - R.APPEAL_AT_MAX_MARKUP)
  const change = clamp(m.change24h, -10, 10)
  const fomo = 1 + (change / 10) * R.FOMO_PER_10_PERCENT
  return { value: byPrice * fomo, markup, change }
}

function reasonToBuy(a: { markup: number; change: number }, ticker: string): string {
  if (a.change >= 2) return `${ticker} is up ${a.change.toFixed(1)} % today`
  if (a.markup <= 1.3) return `${ticker} is a good price`
  return `the crowd is drinking ${ticker}`
}

// ── One game minute ──────────────────────────────────────────────────────────────────────────────────────────────

export function tick(night: Night): Night {
  if (night.minute >= R.NIGHT_MINUTES) return night
  const n = copy(night)

  // Arrivals, while there's room.
  n.arrivalCarry += R.ARRIVALS_BASE + n.reputation * R.ARRIVALS_PER_REPUTATION
  while (n.arrivalCarry >= 1 && n.guests.length < n.capacity) {
    n.arrivalCarry -= 1
    const budget = roundCent(between(n.rng, R.GUEST_BUDGET_USD.min, R.GUEST_BUDGET_USD.max) * 1_000_000)
    const g = { id: n.nextGuest++, budget, spent: 0 }
    n.guests.push(g)
    n.came += 1
    log(n, { minute: n.minute, kind: 'arrive', guest: g.id })
  }
  n.arrivalCarry = Math.min(n.arrivalCarry, 1) // a full room doesn't queue people

  // Energy.
  const fill = n.guests.length / n.capacity
  n.energy += (R.DJ_ENERGY[n.dj] - n.energy) * R.ENERGY_PULL
  if (fill > 0.9) n.energy += R.ENERGY_FULL_ROOM
  else if (fill < 0.3) n.energy += R.ENERGY_EMPTY_ROOM
  n.energy = clamp(n.energy, 0, 100)

  // Orders, guest by guest in arrival order (the order the RNG is drawn in must never change).
  const onMenu = tokenIds.filter((id) => n.menu[id] && n.market[id])
  const orderChance = R.ORDER_CHANCE * (0.5 + n.energy / 100)
  for (const g of n.guests) {
    if (next(n.rng) >= orderChance || onMenu.length === 0) continue
    // Pick a drink with a chance in proportion to its appeal: the hot stock sells most, the others still sell.
    const options = onMenu.map((id) => ({ token: id, ...appeal(n, id)! }))
    let roll = next(n.rng) * options.reduce((sum, o) => sum + o.value, 0)
    const b = options.find((o) => (roll -= o.value) < 0) ?? options.at(-1)!
    const ticker = tokens[b.token].ticker
    const price = priceNow(n, b.token)!
    // The chance to go through with it is the appeal itself: dearer drinks sell less often, never not at all.
    if (next(n.rng) >= b.value) {
      const reason =
        b.markup >= R.MARKUP_FELT_STEEP
          ? `${ticker} at ${b.markup.toFixed(1)}× is too steep`
          : `skipped ${ticker} for now`
      log(n, { minute: n.minute, kind: 'pass', guest: g.id, token: b.token, reason })
      continue
    }
    if (g.budget - g.spent < price) {
      log(n, {
        minute: n.minute,
        kind: 'pass',
        guest: g.id,
        token: b.token,
        reason: `can't afford ${ticker} at ${usd(price)}`,
      })
      continue
    }
    g.spent += price
    const item = n.menu[b.token]!
    const s = (n.sales[b.token] ??= { units: 0, revenue: 0, margin: 0 })
    s.units += 1
    s.revenue += price
    s.margin += price - item.wholesale
    if (!n.served.includes(g.id)) n.served.push(g.id)
    log(n, { minute: n.minute, kind: 'buy', guest: g.id, token: b.token, price, reason: reasonToBuy(b, ticker) })
  }

  // Leaving: out of money, or the room is dead.
  const cheapest = Math.min(...onMenu.map((id) => priceNow(n, id)!))
  n.guests = n.guests.filter((g) => {
    const broke = g.budget - g.spent < cheapest
    const bored = n.energy < R.ENERGY_LEAVE && next(n.rng) < 0.1
    if (broke || bored)
      log(n, { minute: n.minute, kind: 'leave', guest: g.id, reason: broke ? 'out of money' : 'the room is dead' })
    return !(broke || bored)
  })

  n.energySum += n.energy
  n.peakEnergy = Math.max(n.peakEnergy, n.energy)
  n.minute += 1
  return n
}

// ── After the night ──────────────────────────────────────────────────────────────────────────────────────────────

export type NightReport = {
  sales: Partial<Record<TokenId, Sales>>
  units: number
  revenue: number
  margin: number
  wholesale: number
  guestsCame: number
  guestsServed: number
  avgEnergy: number
  peakEnergy: number
  bestSeller: TokenId | null
  reputationBefore: number
  reputationAfter: number
  levelAfter: number
}

export function report(n: Night): NightReport {
  const all = Object.values(n.sales)
  const units = all.reduce((a, s) => a + s.units, 0)
  const revenue = all.reduce((a, s) => a + s.revenue, 0)
  const margin = all.reduce((a, s) => a + s.margin, 0)
  const minutes = Math.max(1, n.minute)
  const avgEnergy = n.energySum / minutes
  const servedRatio = n.came ? n.served.length / n.came : 0
  const reputationAfter = clamp(
    n.reputation + (avgEnergy - n.reputation) * R.REPUTATION_PULL + R.REPUTATION_SERVED_BONUS * (servedRatio - 0.5),
    0,
    100,
  )
  const bestSeller =
    (Object.entries(n.sales) as [TokenId, Sales][]).sort((a, b) => b[1].units - a[1].units)[0]?.[0] ?? null
  return {
    sales: n.sales,
    units,
    revenue,
    margin,
    wholesale: revenue - margin,
    guestsCame: n.came,
    guestsServed: n.served.length,
    avgEnergy: Math.round(avgEnergy * 10) / 10,
    peakEnergy: Math.round(n.peakEnergy * 10) / 10,
    bestSeller,
    reputationBefore: n.reputation,
    reputationAfter: Math.round(reputationAfter * 10) / 10,
    levelAfter: venueFor(reputationAfter).level,
  }
}

export type Strategy = {
  prices?: Partial<Record<TokenId, number>>
  markup?: number
  dj?: R.Genre
  happyHourAt?: number
}

/** Run a whole night at once with fixed CEO choices. */
export function runNight(opts: { seed: number; reputation: number; market: Market }, strategy: Strategy = {}) {
  let n = startNight({ ...opts, dj: strategy.dj })
  for (const id of tokenIds) {
    const item = n.menu[id]
    if (!item) continue
    const target = strategy.prices?.[id] ?? (strategy.markup ? item.wholesale * strategy.markup : undefined)
    if (target !== undefined) {
      const r = setPrice(n, id, Math.min(item.wholesale * MAX_MARKUP, Math.max(item.wholesale, target)))
      if (r.ok) n = r.night
    }
  }
  while (n.minute < R.NIGHT_MINUTES) {
    if (strategy.happyHourAt === n.minute) {
      const r = startHappyHour(n)
      if (r.ok) n = r.night
    }
    n = tick(n)
  }
  return { night: n, report: report(n) }
}

/** Fast-forward: several nights in a row, reputation carried from one to the next. */
export function fastForward(
  opts: { seed: number; reputation: number; market: Market; nights?: number },
  strategy: Strategy = {},
): NightReport[] {
  const out: NightReport[] = []
  let reputation = opts.reputation
  for (let i = 0; i < (opts.nights ?? 7); i++) {
    const { report: r } = runNight({ seed: opts.seed + i, reputation, market: opts.market }, strategy)
    out.push(r)
    reputation = r.reputationAfter
  }
  return out
}

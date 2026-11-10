// The slice of our earlier prototype's game engine that the 3D venue reads, plus `toGameState`: today's Night (from
// @nyxeron/game) dressed up as the state shape the venue was written against. The venue never changes the Night.
import {
  happyHourOn,
  type Market,
  type Night,
  rules,
  startNight,
  type TokenId as GameTokenId,
  tokenIds,
  tokens as gameTokens,
} from '@nyxeron/game'
import bandsJson from './data/bands.json'
import djsJson from './data/djs.json'
import wardrobeJson from './data/wardrobe.json'

// ---------- data ----------

export const djs = djsJson
export const bands = bandsJson
export const wardrobe = wardrobeJson
/** Tonight's drinks are our stocks; every one is on the menu from level 1. */
export const tokens = Object.fromEntries(
  tokenIds.map((id) => [id, { ticker: gameTokens[id].ticker, name: gameTokens[id].name, minLevel: 1 }]),
) as Record<GameTokenId, { ticker: string; name: string; minLevel: number }>

export type TokenId = GameTokenId
export type TalentId = keyof typeof djs
export type BandId = keyof typeof bands
export type Level = 1 | 2 | 3 | 4 | 5
export const ids = <T extends object>(o: T) => Object.keys(o) as (keyof T)[]

/** Night timings the venue keys its show to, in our 300-minute night (22:00 → 03:00). */
export const night = {
  djSetStartMinute: 0,
  peakStartMinute: 90,
  peakEndMinute: 270,
  fightTiltThreshold: 80,
}
export const strategy = { relations: { tablesArriveMinute: 60 } }

// ---------- state ----------

export type GuestState = 'pending' | 'queue' | 'idle' | 'bar' | 'dance' | 'left'
export interface Guest {
  id: number
  budget: number
  tilt: number
  satisfaction: number
  state: GuestState
  female: boolean
}
type TacticId = 'mcHype' | 'hostsFloor' | 'djAnthem' | 'sparkler'
export interface Visitor {
  name: string
  avatar: number
  look?: string
  cash: number
  holdings: Record<string, { qty: number } | undefined>
}
export interface NightState {
  minute: number
  energy: number
  guests: Guest[]
  market: Partial<Record<TokenId, number>>
  tactics: Partial<Record<TacticId, { until: number }>>
  visitors?: Record<string, Visitor>
  guestDj?: { name: string; avatar: number } | null
  bookings?: { vip?: number }
}
export interface GameEvent {
  day: number
  kind: string
  guest: number
}
export interface GameState {
  day: number
  level: Level
  night: NightState | null
  staff: { bartender: number; security: number; host: number }
  upgrades: { vip: number; capacity: number; sound: number; lighting: number }
  bookedTalent: TalentId[]
  bookedBand: BandId | null
  prices: Record<TokenId, number>
  log: GameEvent[]
}

const INSIDE = new Set<GuestState>(['idle', 'bar', 'dance'])
export const isInside = (g: { state: GuestState }) => INSIDE.has(g.state)
export const isAtFightRisk = (g: { tilt: number; state: GuestState }) =>
  isInside(g) && g.tilt >= night.fightTiltThreshold
export const isPeakTime = (s: GameState) => {
  const m = s.night?.minute
  return m !== undefined && s.bookedTalent.length > 0 && m >= night.peakStartMinute && m < night.peakEndMinute
}
export const bandPlaying = (s: GameState) => !!s.bookedBand && !!s.night
export const capacityOf = (s: GameState) => rules.VENUES[Math.min(4, s.level) - 1]!.capacity
export const active = (n: NightState, id: TacticId) => (n.tactics[id]?.until ?? -1) > n.minute
export const marketOf = (n: NightState | null | undefined, t: TokenId) => n?.market?.[t] ?? 1
/** Tonight's menu price in micro-USDC. */
export const marketPrice = (s: GameState, t: TokenId) => s.prices[t] ?? 0

// ---------- avatars ----------

export type SkinId = keyof typeof wardrobe.skins
export type ItemId = keyof typeof wardrobe.items
type Slot = keyof typeof wardrobe.presets.masc
export type Item = (typeof wardrobe.items)[ItemId] & { accent?: string; price?: number }
export interface Avatar {
  skin: SkinId
  items: Partial<Record<Slot, ItemId>>
}
const SLOTS = wardrobe.slots as Slot[]
export const itemOf = (id: ItemId) => wardrobe.items[id] as Item

function rng(seed: number) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { chance: (p: number) => next() < p, pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! }
}

/** A believable random outfit, the same every time for the same seed. */
export function randomAvatar(seed: number, female: boolean): Avatar {
  const r = rng(seed)
  const pool = female ? wardrobe.presets.fem : wardrobe.presets.masc
  const chance = wardrobe.presets.chance as Partial<Record<Slot, number>>
  const items: Avatar['items'] = {}
  for (const slot of SLOTS) {
    const list = pool[slot] as ItemId[]
    if (!list.length) continue
    const p = chance[slot] ?? 1
    if (p < 1 && !r.chance(p)) continue
    items[slot] = r.pick(list)
  }
  // A dress already covers the top of the legs; shorts under it would poke out.
  if (items.shirt && itemOf(items.shirt).style === 'dress' && items.pants) {
    const skirt = pool.pants.find((id) => itemOf(id as ItemId).style === 'skirt')
    if (skirt) items.pants = skirt as ItemId
  }
  return { skin: r.pick(Object.keys(wardrobe.skins) as SkinId[]), items }
}
export const legacyAvatar = (n: number): Avatar =>
  randomAvatar(7919 * Math.max(1, Math.min(10, Math.round(n) || 1)), n > 5)
export const decodeAvatar = (_text: unknown, fallback: Avatar) => fallback

// ---------- app hooks the venue expected (no-ops here) ----------

export type ClipMode = 'off' | 'peak' | 'always'
export { audio } from '../audio/music.ts'
export const layoutKey = (name: string) => `nyxeron.venue.layout.${name}`
export const syncHooks: { layout?: (name: string, json: string | null) => void } = {}
export const getShoutouts = (): string[] => []
export const en = {
  unit: '',
  bands: { live: 'LIVE' },
  guest: { you: 'YOU' },
  venue: { vipLocked: 'opens at level 3', tokenBoard: "TONIGHT'S STOCKS" },
  videotron: {
    shoutout: 'SHOUTOUT',
    anthem: 'THE ANTHEM',
    bottles: 'HAPPY HOUR',
    sparklers: '−20 % ON EVERY DRINK',
    mc: 'MC ON THE MIC',
    handsUp: 'HANDS UP!',
    floor: 'HOSTS ON THE FLOOR',
    everybody: 'EVERYBODY DANCE',
    topSpenders: 'TOP SPENDERS TONIGHT',
    movers: 'TOP MOVERS',
    nowPlaying: 'NOW ON THE DECKS',
    welcome: 'WELCOME TO',
    names: ['RAKA', 'DINA', 'BIMO', 'SARAH', 'KEVIN', 'MAYA', 'ANDRE', 'NADIA', 'RIZKY', 'CLARA', 'DIMAS', 'PUTRI'],
  },
}

// ---------- our Night → the venue's state ----------

const DJ_FOR: Record<string, TalentId> = { house: 'mira', techno: 'nova', hiphop: 'kalu', pop: 'lux', lounge: 'jax' }
const hash = (n: number) => {
  let t = (n * 2654435761) >>> 0
  t ^= t >>> 15
  t = Math.imul(t, 2246822519) >>> 0
  return (t >>> 0) / 4294967296
}
/**
 * What each level's room has. Level 4 is the superclub: a bartender pair at each of its two bars, hosts working the
 * tables, the full sound and light rig, and VIP tables (three seats each) up on both balconies.
 */
const TIERS = [
  {
    staff: { bartender: 1, security: 1, host: 0 },
    upgrades: { vip: 0, capacity: 0, sound: 0, lighting: 0 },
    vipTables: 0,
  },
  {
    staff: { bartender: 2, security: 1, host: 0 },
    upgrades: { vip: 0, capacity: 0, sound: 1, lighting: 1 },
    vipTables: 0,
  },
  {
    staff: { bartender: 2, security: 2, host: 1 },
    upgrades: { vip: 1, capacity: 0, sound: 2, lighting: 2 },
    vipTables: 2,
  },
  {
    staff: { bartender: 4, security: 3, host: 3 },
    upgrades: { vip: 1, capacity: 0, sound: 3, lighting: 3 },
    vipTables: 6,
  },
] as const
/** Share of guests out dancing (the rest sit: in the superclub that's the high tables and the pool-deck cabanas). */
const DANCE_SHARE = [0.78, 0.78, 0.74, 0.62]
/** Minutes a guest stays at the bar after a buy. */
const AT_BAR = 4
/** Minutes a guest who left is still walked out. */
const LEAVING = 6

/**
 * Today's Night as the venue's state. Guests dance or hang out by their id, stand at the bar for a few minutes after
 * each buy, and walk out when they leave. Staff, upgrades and the DJ follow the venue level and tonight's genre.
 */
export function toGameState(n: Night, level: number): GameState {
  const L = Math.min(4, Math.max(1, Math.round(level))) as Level
  const lastBuy = new Map<number, number>()
  const left = new Map<number, number>()
  for (const e of n.log) {
    if (e.kind === 'buy') lastBuy.set(e.guest, e.minute)
    if (e.kind === 'leave') left.set(e.guest, e.minute)
  }
  const guests: Guest[] = n.guests.map((g) => {
    const bought = lastBuy.get(g.id)
    const state: GuestState =
      bought !== undefined && n.minute - bought < AT_BAR ? 'bar' : hash(g.id) < DANCE_SHARE[L - 1]! ? 'dance' : 'idle'
    return {
      id: g.id,
      budget: Math.round((g.budget - g.spent) / 10_000), // cents: a buy shows up as the budget dropping
      tilt: 0,
      satisfaction: Math.min(100, 50 + n.energy / 2),
      state,
      female: hash(g.id + 77) < 0.5,
    }
  })
  const inside = new Set(n.guests.map((g) => g.id))
  for (const [id, minute] of left)
    if (!inside.has(id) && n.minute - minute < LEAVING)
      guests.push({ id, budget: 0, tilt: 0, satisfaction: 50, state: 'left', female: hash(id + 77) < 0.5 })

  const market: NightState['market'] = {}
  const prices = {} as Record<TokenId, number>
  for (const id of tokenIds) {
    const m = n.market[id]
    if (m) market[id] = 1 + m.change24h / 100
    prices[id] = n.menu[id]?.price ?? 0
  }
  const happy = happyHourOn(n)
  return {
    day: 1,
    level: L,
    night: {
      minute: n.minute,
      energy: n.energy,
      guests,
      market,
      // Happy hour shows as the sparkler parade: the board calls it and the tables light up.
      tactics: happy ? { sparkler: { until: n.minute + 1 } } : {},
      bookings: { vip: TIERS[L - 1]!.vipTables },
    },
    staff: TIERS[L - 1]!.staff,
    upgrades: TIERS[L - 1]!.upgrades,
    bookedTalent: [DJ_FOR[n.dj] ?? 'mira'],
    bookedBand: null,
    prices,
    log: [],
  }
}

/**
 * A busy night at this level for the venue picker: most of the room dancing, a few at the bar and the tables, and
 * tonight's menu at the game's opening prices (1.5× wholesale) for `market`.
 */
export function previewState(level: number, market: Market): GameState {
  const L = Math.min(4, Math.max(1, Math.round(level))) as Level
  const opening = startNight({ seed: 1, reputation: 100, market, level: L })
  const count = Math.round(rules.VENUES[L - 1]!.capacity * 0.6)
  const guests: Guest[] = Array.from({ length: count }, (_, i) => {
    const r = hash(i + 101)
    return {
      id: i + 1,
      budget: 2000,
      tilt: 0,
      satisfaction: 85,
      state: r < 0.12 ? 'bar' : r < 0.3 ? 'idle' : 'dance',
      female: hash(i + 178) < 0.5,
    }
  })
  const s = toGameState(opening, L)
  return { ...s, night: { ...s.night!, minute: 150, energy: 80, guests } }
}

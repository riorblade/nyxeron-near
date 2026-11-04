// Every number the party simulation runs on. Change them here, nowhere else.

/** A night runs 22:00 → 03:00, one tick per game minute. */
export const NIGHT_MINUTES = 300
export const NIGHT_STARTS_AT = 22 * 60

/** Room size per venue level, and the reputation needed to reach it. */
export const VENUES = [
  { level: 1, capacity: 30, reputation: 0 },
  { level: 2, capacity: 60, reputation: 25 },
  { level: 3, capacity: 100, reputation: 50 },
  { level: 4, capacity: 150, reputation: 75 },
] as const

/** Guests trying to get in per minute: a base plus more for a better reputation. */
export const ARRIVALS_BASE = 0.6
export const ARRIVALS_PER_REPUTATION = 0.02

/** A simulated guest's budget for the night, in USD (spent in micro-USDC). */
export const GUEST_BUDGET_USD = { min: 3, max: 20 } as const

/** Chance per minute that a guest orders, at energy 50; scaled by energy from ×0.5 (dead room) to ×1.5 (on fire). */
export const ORDER_CHANCE = 0.03

/** A guest's pull towards a drink falls with your markup: 1 at wholesale, this at the 3× cap. */
export const APPEAL_AT_MAX_MARKUP = 0.1
/** A stock up 10 % today is this much more appealing (and one down 10 % this much less). Capped at ±10 %. */
export const FOMO_PER_10_PERCENT = 0.5
/** Above this markup, a guest who passes says the price is the reason. */
export const MARKUP_FELT_STEEP = 1.8

/** Energy each DJ genre settles the crowd at. */
export const DJ_ENERGY = { house: 70, techno: 80, hiphop: 75, pop: 60, lounge: 40 } as const
export type Genre = keyof typeof DJ_ENERGY
/** How fast energy moves towards the DJ's level each minute (share of the gap). */
export const ENERGY_PULL = 0.05
/** A packed room (over 90 % full) adds energy each minute; a near-empty one (under 30 %) takes it away. */
export const ENERGY_FULL_ROOM = 0.6
export const ENERGY_EMPTY_ROOM = -0.6
/** Switching DJ costs this much energy at once while the next set starts. */
export const ENERGY_DJ_SWITCH = -8
/** Guests leave when energy drops below this. */
export const ENERGY_LEAVE = 20

/** Happy hour: once a night, 20 minutes, prices −20 % (never below wholesale) and an energy jolt. */
export const HAPPY_HOUR_MINUTES = 20
export const HAPPY_HOUR_DISCOUNT = 0.2
export const HAPPY_HOUR_ENERGY = 10

/** Reputation after a night: towards the night's average energy, plus how many guests got a drink. */
export const REPUTATION_PULL = 0.2
export const REPUTATION_SERVED_BONUS = 10

// Seeded random numbers (mulberry32): the same seed gives the same night, on the browser and on the server.
// The state is one number, so it lives inside the game state and a saved night resumes exactly.

export type Rng = { state: number }

export function rng(seed: number): Rng {
  return { state: seed >>> 0 }
}

/** Next number in [0, 1). Advances the generator in place. */
export function next(r: Rng): number {
  r.state = (r.state + 0x6d2b79f5) >>> 0
  let t = r.state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function between(r: Rng, min: number, max: number): number {
  return min + next(r) * (max - min)
}

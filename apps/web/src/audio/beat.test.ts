import { expect, it } from 'vitest'
import { BeatTracker } from './beat.ts'

// 60 frames a second of a four-on-the-floor kick at 120 BPM: the bass jumps every 500 ms and decays between.
function play(b: BeatTracker, from: number, ms: number, loud: number) {
  for (let t = from; t < from + ms; t += 1000 / 60) {
    const sinceKick = t % 500
    b.update(loud * Math.exp(-sinceKick / 80), loud, t)
  }
  return from + ms
}

it('finds the kick and pulses on it', () => {
  const b = new BeatTracker()
  const t = play(b, 0, 4000, 0.8)
  expect(t - b.lastKick).toBeLessThan(500)
  expect(b.pulse(b.lastKick)).toBe(1)
  expect(b.pulse(b.lastKick + 400)).toBeLessThan(0.1)
})

it('marks the drop when the beat comes back after a breakdown', () => {
  const b = new BeatTracker()
  let t = play(b, 0, 20_000, 0.8)
  expect(b.dropAt).toBe(-1)
  t = play(b, t, 4000, 0.2) // breakdown
  expect(b.intensity).toBeLessThan(0.85)
  play(b, t, 3000, 0.8)
  expect(b.dropAt).toBeGreaterThan(t)
})

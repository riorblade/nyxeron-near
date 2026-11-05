// Walk, idle and dance poses computed from the beat: no animation files. Each guest gets its own move, tempo offset
// and energy from its id, so a crowd never moves in lockstep. Radians; limbs hang down (-y) in the bind pose, so a
// negative X swings a limb forward and a positive Z lifts the left arm out. From our earlier prototype, trimmed.
import type { BoneName, Rig } from './rig.ts'

export const DANCES = ['bounce', 'pump', 'sway', 'handsUp', 'twoStep', 'groove', 'shuffle'] as const
export type Move = (typeof DANCES)[number] | 'idle' | 'walk'
type Pose = Partial<Record<BoneName, [number, number, number]>>
const TAU = Math.PI * 2

function pose(move: Move, b: number, e: number): { pose: Pose; lift: number; sway: number } {
  const ph = b * TAU
  const s = Math.sin(ph)
  const half = Math.sin(ph / 2)
  const bob = (1 - Math.cos(ph)) / 2
  const knee = 0.25 + 0.35 * e
  const legs: Pose = {
    lThigh: [-knee * bob * 0.6, 0, 0],
    rThigh: [-knee * bob * 0.6, 0, 0],
    lShin: [knee * bob * 1.1, 0, 0],
    rShin: [knee * bob * 1.1, 0, 0],
  }
  const drop = -0.035 * e * bob
  switch (move) {
    case 'idle':
      return {
        pose: {
          chest: [0.02 * Math.sin(ph / 4), 0, 0],
          lArm: [0, 0, 0.06],
          rArm: [0, 0, -0.06],
          lFore: [-0.15, 0, 0],
          rFore: [-0.15, 0, 0],
          head: [0, 0.15 * Math.sin(ph / 8), 0],
        },
        lift: 0,
        sway: 0,
      }
    case 'walk':
      return {
        pose: {
          lThigh: [0.55 * s, 0, 0],
          rThigh: [-0.55 * s, 0, 0],
          lShin: [0.5 * Math.max(0, -s), 0, 0],
          rShin: [0.5 * Math.max(0, s), 0, 0],
          lArm: [-0.45 * s, 0, 0.05],
          rArm: [0.45 * s, 0, -0.05],
          lFore: [-0.3, 0, 0],
          rFore: [-0.3, 0, 0],
        },
        lift: 0.012 * Math.abs(s),
        sway: 0,
      }
    case 'bounce':
      return {
        pose: {
          ...legs,
          lArm: [-0.4 * s * e, 0, 0.15],
          rArm: [0.4 * s * e, 0, -0.15],
          lFore: [-1.1, 0, 0],
          rFore: [-1.1, 0, 0],
          head: [0.12 * bob, 0, 0],
          chest: [0.08 * bob, 0, 0],
        },
        lift: drop,
        sway: 0,
      }
    case 'pump':
      return {
        pose: {
          ...legs,
          rArm: [0, 0, -2.75],
          rFore: [-0.4 - 0.7 * bob, 0, 0],
          lArm: [-0.3, 0, 0.2],
          lFore: [-1.2, 0, 0],
          head: [0.15 * bob, 0, 0.1],
          chest: [0.05 * bob, 0.15, 0],
        },
        lift: drop,
        sway: 0,
      }
    case 'sway':
      return {
        pose: {
          chest: [0, 0.2 * half, 0.12 * half],
          head: [0, -0.15 * half, -0.12 * half],
          lArm: [-0.2, 0, 0.35 + 0.2 * half],
          rArm: [-0.2, 0, -0.35 + 0.2 * half],
          lFore: [-0.9, 0, 0],
          rFore: [-0.9, 0, 0],
          lThigh: [-0.15 * Math.max(0, half), 0, 0],
          rThigh: [-0.15 * Math.max(0, -half), 0, 0],
          lShin: [0.3 * Math.max(0, half), 0, 0],
          rShin: [0.3 * Math.max(0, -half), 0, 0],
        },
        lift: 0,
        sway: 0.035 * half,
      }
    case 'handsUp':
      return {
        pose: {
          ...legs,
          lArm: [0, 0, 2.7 + 0.25 * half],
          rArm: [0, 0, -2.7 + 0.25 * half],
          lFore: [-0.25, 0, 0],
          rFore: [-0.25, 0, 0],
          head: [-0.2 + 0.1 * bob, 0, 0],
          chest: [-0.06, 0, 0.08 * half],
        },
        lift: drop,
        sway: 0.02 * half,
      }
    case 'twoStep': {
      const l = Math.max(0, half)
      const r = Math.max(0, -half)
      return {
        pose: {
          lThigh: [-0.7 * l * e, 0, 0],
          lShin: [1.0 * l * e, 0, 0],
          rThigh: [-0.7 * r * e, 0, 0],
          rShin: [1.0 * r * e, 0, 0],
          lArm: [0.35 * half, 0, 0.2],
          rArm: [-0.35 * half, 0, -0.2],
          lFore: [-1.3, 0, 0],
          rFore: [-1.3, 0, 0],
          chest: [0.05, 0.12 * half, 0],
          head: [0.1 * bob, 0, 0],
        },
        lift: 0.015 * (l + r),
        sway: 0.03 * half,
      }
    }
    case 'groove':
      return {
        pose: {
          ...legs,
          chest: [0.06 * bob, 0.28 * s, 0],
          hips: [0, -0.12 * s, 0],
          lArm: [-0.5, 0, 0.25],
          rArm: [-0.5, 0, -0.25],
          lFore: [-1.4 + 0.3 * s, 0, 0],
          rFore: [-1.4 - 0.3 * s, 0, 0],
          head: [0.15 * bob, -0.2 * s, 0],
        },
        lift: drop,
        sway: 0,
      }
    case 'shuffle': {
      const k = Math.sin(ph * 2)
      return {
        pose: {
          lThigh: [-0.5 * Math.max(0, k), 0, 0.1],
          rThigh: [-0.5 * Math.max(0, -k), 0, -0.1],
          lShin: [0.3 * Math.max(0, k), 0, 0],
          rShin: [0.3 * Math.max(0, -k), 0, 0],
          lArm: [-0.6 * s, 0, 0.3],
          rArm: [0.6 * s, 0, -0.3],
          lFore: [-0.8, 0, 0],
          rFore: [-0.8, 0, 0],
          chest: [0.1, 0, 0],
        },
        lift: 0.02 * Math.abs(k),
        sway: 0.02 * s,
      }
    }
  }
}

/** Puts `rig` in `move` at beat `b`; every bone not in the pose goes back to rest. */
export function applyMove(rig: Rig, move: Move, b: number, energy = 0.7) {
  const { pose: p, lift, sway } = pose(move, b, energy)
  for (const name of Object.keys(rig.bones) as BoneName[]) {
    const r = p[name]
    if (r) rig.bones[name].rotation.set(r[0], r[1], r[2])
    else rig.bones[name].rotation.set(0, 0, 0)
  }
  rig.bones.hips.position.copy(rig.rest.hips)
  rig.bones.hips.position.y += lift
  rig.bones.hips.position.x += sway
}

/** The dance a guest is doing at beat `b`: its own move, tempo offset and size, changing every 8–16 beats. */
export function danceAt(seed: number, b: number): { move: Move; beat: number; energy: number } {
  const h = (n: number) => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  const beat = b + h(2)
  const round = Math.floor(beat / (8 + Math.floor(h(4) * 9)))
  const i = round === 0 ? Math.floor(h(1) * DANCES.length) : Math.floor(h(10 + round) * DANCES.length)
  return { move: DANCES[i]!, beat, energy: 0.5 + 0.5 * h(3) }
}

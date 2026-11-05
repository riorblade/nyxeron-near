// Blocky voxel characters: rigid parts on a 12-bone skeleton, merged into ONE SkinnedMesh (one draw call each, one
// shared material). Built in code, no model files. Bind pose height is 1 (scale the root). From our earlier prototype,
// trimmed: a guest's look comes from its id instead of a wardrobe.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const BONES = [
  'root',
  'hips',
  'chest',
  'head',
  'lArm',
  'lFore',
  'rArm',
  'rFore',
  'lThigh',
  'lShin',
  'rThigh',
  'rShin',
] as const
export type BoneName = (typeof BONES)[number]
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>

type V3 = [number, number, number]
const JOINTS: Record<BoneName, { at: V3; parent: BoneName | null }> = {
  root: { at: [0, 0, 0], parent: null },
  hips: { at: [0, 0.46, 0], parent: 'root' },
  chest: { at: [0, 0.6, 0], parent: 'hips' },
  head: { at: [0, 0.8, 0], parent: 'chest' },
  lArm: { at: [0.215, 0.77, 0], parent: 'chest' },
  lFore: { at: [0.215, 0.61, 0], parent: 'lArm' },
  rArm: { at: [-0.215, 0.77, 0], parent: 'chest' },
  rFore: { at: [-0.215, 0.61, 0], parent: 'rArm' },
  lThigh: { at: [0.075, 0.46, 0], parent: 'hips' },
  lShin: { at: [0.075, 0.24, 0], parent: 'lThigh' },
  rThigh: { at: [-0.075, 0.46, 0], parent: 'hips' },
  rShin: { at: [-0.075, 0.24, 0], parent: 'rThigh' },
}

export type Look = {
  skin: string
  shirt: string
  shirtStyle: 'tee' | 'tank' | 'jacket' | 'dress'
  accent: string
  pants: string
  hair: string
  hairStyle: 'buzz' | 'short' | 'long' | 'afro' | 'bun' | 'none'
  hat?: string
  shades?: boolean
}

const SKINS = ['#f1c7a5', '#e0a67f', '#c68642', '#8d5524', '#5c3a21', '#ffdbac']
const SHIRTS = ['#ff2bd6', '#22d3ee', '#a855f7', '#f5c451', '#f4f4f5', '#18181b', '#3ee08f', '#ff6b4a', '#4f7cff']
const PANTS = ['#1f2937', '#111827', '#374151', '#1e3a8a', '#3f2a1d', '#d4d4d8']
const HAIRS = ['#1b1b1f', '#3b2416', '#7a4a24', '#d6b36a', '#b23a48', '#e5e5e5', '#ff2bd6']

/** A guest's look, the same every time for the same id. */
export function lookFor(seed: number): Look {
  let s = (seed * 2654435761) >>> 0
  const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!
  const shirtStyle = pick(['tee', 'tee', 'tank', 'jacket', 'dress'] as const)
  return {
    skin: pick(SKINS),
    shirt: pick(SHIRTS),
    shirtStyle,
    accent: pick(SHIRTS),
    pants: pick(PANTS),
    hair: pick(HAIRS),
    hairStyle: pick(['buzz', 'short', 'short', 'long', 'afro', 'bun', 'none'] as const),
    hat: next() < 0.18 ? pick(SHIRTS) : undefined,
    shades: next() < 0.2,
  }
}

function block(size: V3, at: V3, color: string, bone: BoneName, round = 0.012): THREE.BufferGeometry {
  const r = Math.min(round, ...size.map((v) => v / 2 - 0.001))
  const g = r > 0.002 ? new RoundedBoxGeometry(size[0], size[1], size[2], 1, r) : new THREE.BoxGeometry(...size)
  g.translate(...at)
  return colour(g, color, bone)
}

function parts(a: Look): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  const add = (...g: THREE.BufferGeometry[]) => out.push(...g)
  const dress = a.shirtStyle === 'dress'
  // Torso, belt line, arms.
  add(block([0.3, 0.33, 0.16], [0, 0.635, 0], a.shirtStyle === 'jacket' ? a.accent : a.shirt, 'chest', 0.02))
  if (a.shirtStyle === 'jacket')
    for (const x of [-0.085, 0.085]) add(block([0.13, 0.335, 0.03], [x, 0.635, 0.075], a.shirt, 'chest', 0.008))
  add(block([0.29, 0.06, 0.15], [0, 0.47, 0], dress ? a.shirt : a.pants, 'hips', 0.01))
  const upper = a.shirtStyle === 'tank' || dress ? a.skin : a.shirt
  for (const [side, x] of [
    ['l', 0.215],
    ['r', -0.215],
  ] as const) {
    add(block([0.1, 0.17, 0.1], [x, 0.69, 0], upper, `${side}Arm`))
    add(block([0.096, 0.13, 0.096], [x, 0.545, 0], a.shirtStyle === 'jacket' ? a.shirt : a.skin, `${side}Fore`))
    add(block([0.09, 0.06, 0.09], [x, 0.455, 0], a.skin, `${side}Fore`, 0.02))
    // Legs and shoes.
    add(block([0.125, 0.22, 0.125], [x * 0.35, 0.35, 0], dress ? a.skin : a.pants, `${side}Thigh`))
    add(block([0.12, 0.18, 0.12], [x * 0.35, 0.15, 0], dress ? a.skin : a.pants, `${side}Shin`))
    add(block([0.128, 0.06, 0.17], [x * 0.35, 0.03, 0.02], '#18181b', `${side}Shin`, 0.015))
  }
  if (dress) {
    const skirt = new THREE.CylinderGeometry(0.155, 0.2, 0.17, 10)
    skirt.translate(0, 0.38, 0)
    add(colour(skirt, a.shirt, 'hips'))
  }
  // Head and face.
  add(block([0.19, 0.19, 0.18], [0, 0.9, 0], a.skin, 'head', 0.035))
  add(block([0.07, 0.04, 0.07], [0, 0.805, 0], a.skin, 'head', 0.01))
  for (const x of [-0.042, 0.042]) add(block([0.024, 0.03, 0.01], [x, 0.915, 0.09], '#1b1b1f', 'head', 0.004))
  add(block([0.05, 0.012, 0.01], [0, 0.86, 0.09], '#7a3b33', 'head', 0.003))
  if (a.shades) add(block([0.17, 0.045, 0.02], [0, 0.915, 0.097], '#0a0a0a', 'head', 0.008))
  // Hair, then a cap over it.
  const h = a.hairStyle
  if (h === 'buzz') add(block([0.196, 0.025, 0.186], [0, 0.99, 0], a.hair, 'head', 0.01))
  if (h === 'short' || h === 'long' || h === 'bun') {
    add(block([0.205, 0.05, 0.195], [0, 0.99, -0.002], a.hair, 'head', 0.02))
    add(block([0.2, 0.12, 0.04], [0, 0.93, -0.083], a.hair, 'head', 0.015))
  }
  if (h === 'long') add(block([0.21, 0.23, 0.045], [0, 0.84, -0.09], a.hair, 'head', 0.02))
  if (h === 'bun') add(block([0.08, 0.07, 0.08], [0, 1.04, -0.04], a.hair, 'head', 0.03))
  if (h === 'afro') add(block([0.28, 0.17, 0.26], [0, 0.99, -0.02], a.hair, 'head', 0.07))
  if (a.hat && h !== 'afro') {
    add(block([0.205, 0.06, 0.195], [0, 1.005, 0], a.hat, 'head', 0.025))
    add(block([0.17, 0.015, 0.09], [0, 0.985, 0.12], a.hat, 'head', 0.006))
  }
  return out
}

// Vertex colour + a rigid bind to one bone, so every part merges into one skinned mesh.
function colour(g: THREE.BufferGeometry, color: string, bone: BoneName) {
  const geo = g.index ? g.toNonIndexed() : g
  const n = geo.getAttribute('position').count
  const c = new THREE.Color(color)
  geo.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3),
  )
  const idx = new Uint16Array(n * 4)
  const w = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    idx[i * 4] = B[bone]
    w[i * 4] = 1
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4))
  geo.deleteAttribute('uv')
  return geo
}

/** Vertex colours that glow a little on their own, so a dark club never turns guests into silhouettes. */
function avatarMaterial(glow: number) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true })
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * ${glow.toFixed(2)};`,
    )
  }
  return m
}
const shared = avatarMaterial(0.25)

export type Rig = {
  mesh: THREE.SkinnedMesh
  bones: Record<BoneName, THREE.Bone>
  rest: Record<BoneName, THREE.Vector3>
  dispose(): void
}

/** A character: add `rig.mesh` to the scene and pose `rig.bones` (moves.ts). */
export function buildRig(look: Look): Rig {
  const geo = mergeGeometries(parts(look))!
  const bones = {} as Record<BoneName, THREE.Bone>
  const rest = {} as Record<BoneName, THREE.Vector3>
  for (const name of BONES) {
    const b = new THREE.Bone()
    const { at, parent } = JOINTS[name]
    const p: V3 = parent ? JOINTS[parent].at : [0, 0, 0]
    b.position.set(at[0] - p[0], at[1] - p[1], at[2] - p[2])
    rest[name] = b.position.clone()
    if (parent) bones[parent].add(b)
    bones[name] = b
  }
  const mesh = new THREE.SkinnedMesh(geo, shared)
  mesh.add(bones.root)
  mesh.bind(new THREE.Skeleton(BONES.map((n) => bones[n])))
  mesh.frustumCulled = false // bones move parts outside the bind-pose bounds
  return { mesh, bones, rest, dispose: () => geo.dispose() }
}

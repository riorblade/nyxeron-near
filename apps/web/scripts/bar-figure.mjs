// Builds the landing's isometric figure (src/landing/bar-figure.ts): the bar a drink goes through, one machine per
// stop of "One drink, four stops". A card reader (sign in), a coin terminal (order), a splitter with the host's tip jar
// and the treasury safe (split), and a tap that drops a share chip onto the guest's stack (settle). Static geometry is
// computed here once; the page moves the four marked parts. Run: node scripts/bar-figure.mjs
import { writeFileSync } from 'node:fs'
import * as k from './iso/iso-kit.mjs'

const WIDTH = 640
const HEIGHT = 380

// The counter, in world units (about a pixel of the real thing): x along the bar, y across it, z up.
const TOP = { x: -164, y: -52, w: 300, d: 104, r: 6 }
const TOP_H = 12
const FOOT_H = 6

const READER = { x: -150, y: -20, w: 34, d: 40, r: 3 }
const READER_H = 26
const TERMINAL = { x: -96, y: -24, w: 44, d: 48, r: 4 }
const TERMINAL_H = 20
const FUNNEL = [-74, 0]
const SPLIT = { x: -26, y: -8, w: 22, d: 16, r: 2 }
const SPLIT_H = 10
const JAR = [-4, -36]
const JAR_R = 11
const JAR_H = 26
const SAFE = { x: 4, y: 18, w: 40, d: 30, r: 2 }
const SAFE_H = 30
const TAP = [96, 14]
const TAP_TOP = 74
const STACK = [96, -22]
const CHIP_R = 6.5
const CHIP_H = 1.6

const P = k.fitProjection(
  [...k.boxCorners(TOP, -TOP_H - FOOT_H, 0), [TAP[0], TAP[1], TAP_TOP + 12], [READER.x, 0, 70]],
  WIDTH,
  HEIGHT,
  { pad: 8, azimuth: 40 },
)

const at = (point) => k.iso(point, P)
const S = (paths, style) => k.solidSvg(paths, style)
const L = (d, style) => k.lineSvg(d, style)
const D = (points, style) => k.dotsSvg(points, style)
const depth = ([x, y]) => k.depthOf([x, y, 0], P)

function counter() {
  const out = [`<path class="iso-halo" d="${k.haloOf(TOP, -TOP_H - FOOT_H, TOP_H, P)}"/>`]
  const feet = k.corners(TOP, 20).sort((a, b) => depth(a) - depth(b))
  for (const [x, y] of feet) {
    out.push(S(k.cylinder(x, y, 7, -TOP_H - FOOT_H, 2, P, 28), { tone: 'lo' }))
    out.push(S(k.cylinder(x, y, 5, -TOP_H - FOOT_H + 2, FOOT_H - 2, P, 28), { tone: 'mid' }))
  }
  out.push(S(k.slabOf(TOP, -TOP_H, TOP_H, P, 8, 1.6), { tone: 'mid' }))
  out.push(L(k.planOutline(k.insetPlan(TOP, 5), 0, P), { tone: 'lo' }))
  const screws = k.corners(TOP, 10)
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(''), { tone: 'lo' }))
  out.push(
    D(
      screws.map(([x, y]) => at([x, y, 0])),
      { size: 0.5 },
    ),
  )
  // a brass rail along the guest's edge, with a ruler strip of 0.001 steps
  const strip = { x: TOP.x + 14, y: TOP.y + TOP.d - 14, w: TOP.w - 28, d: 7, r: 1 }
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: 'lo', crease: 'none' }))
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P)
  out.push(L(ticks.minor, { tone: 'lo' }), L(ticks.major, { tone: 'mid' }))
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }))
  return out.join('')
}

function reader() {
  const out = []
  out.push(S(k.slabOf(READER, 0, 6, P, 6, 0.6), { tone: 'mid' }))
  out.push(S(k.slabOf(k.insetPlan(READER, 2), 6, READER_H - 6, P, 6, 0.8), { tone: 'mid' }))
  const top = k.insetPlan(READER, 2)
  // the card slot, and the light that turns on when a card is read
  const cx = READER.x + READER.w / 2
  out.push(
    S(k.slabOf({ x: cx - 2.2, y: READER.y + 7, w: 4.4, d: READER.d - 14, r: 1 }, READER_H, 0.4, P, 3), {
      tone: 'lo',
      crease: 'none',
    }),
  )
  out.push(L(k.lineOnTop([cx, READER.y + 8], [cx, READER.y + READER.d - 8], READER_H + 0.4, P), { tone: 'hi' }))
  out.push(
    D(
      [
        at([top.x + 4, top.y + 4, READER_H]),
        at([top.x + top.w - 4, top.y + 4, READER_H]),
        at([top.x + 4, top.y + top.d - 4, READER_H]),
        at([top.x + top.w - 4, top.y + top.d - 4, READER_H]),
      ],
      { size: 0.45 },
    ),
  )
  out.push(L(k.ring(READER.x + 8, READER.y + READER.d - 6, 2.4, READER_H, P, 16), { tone: 'mid' }))
  out.push(
    `<g data-part="led">${D([at([READER.x + 8, READER.y + READER.d - 6, READER_H])], { size: 1.1, tone: 'lo' })}</g>`,
  )
  // a cable from the reader's back to the terminal
  out.push(L(k.lineOnTop([READER.x + READER.w, READER.y + 6], [TERMINAL.x, TERMINAL.y + 10], 0.4, P), { tone: 'lo' }))
  out.push(D([at([READER.x + READER.w, READER.y + 6, 0.4]), at([TERMINAL.x, TERMINAL.y + 10, 0.4])], { size: 0.6 }))
  return out.join('')
}

function card() {
  const cx = READER.x + READER.w / 2
  const plan = { x: cx - 0.9, y: READER.y + 9, w: 1.8, d: READER.d - 18, r: 0.4 }
  const out = [S(k.slabOf(plan, READER_H - 6, 30, P, 2), { tone: 'hi', lit: true })]
  // the card's chip, engraved on its face
  out.push(
    L(k.planOutline({ x: cx - 0.9, y: READER.y + 13, w: 1.8, d: 5, r: 0.3 }, READER_H + 18, P, 2), { tone: 'mid' }),
  )
  return out.join('')
}

function terminal() {
  const out = []
  out.push(S(k.slabOf(TERMINAL, 0, 6, P, 6, 0.6), { tone: 'mid' }))
  out.push(S(k.slabOf(k.insetPlan(TERMINAL, 2), 6, TERMINAL_H - 6, P, 6, 0.8), { tone: 'mid' }))
  const [fx, fy] = FUNNEL
  out.push(S(k.cylinder(fx, fy, 13, TERMINAL_H, 3, P, 40, 0.6), { tone: 'mid' }))
  out.push(S(k.cylinder(fx, fy, 10.5, TERMINAL_H + 3, 5, P, 40, 0.5), { tone: 'mid' }))
  out.push(L(k.ring(fx, fy, 8, TERMINAL_H + 8, P, 40), { tone: 'lo' }))
  out.push(L(k.ring(fx, fy, 5, TERMINAL_H + 8, P, 32), { tone: 'faint' }))
  const ticks = k.radialTicks(fx, fy, 10, 24, 6, TERMINAL_H + 8, [0.8, 1.6], P)
  out.push(L(ticks.minor, { tone: 'lo' }), L(ticks.major, { tone: 'mid' }))
  // a keypad: four by three keys
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 2; col++) {
      const key = { x: TERMINAL.x + 30 + col * 5.5, y: TERMINAL.y + 8 + row * 6, w: 4, d: 4.4, r: 0.8 }
      out.push(S(k.slabOf(key, TERMINAL_H, 1.2, P, 3, 0.2), { tone: 'mid', crease: 'none' }))
    }
  out.push(
    D(
      k.corners(k.insetPlan(TERMINAL, 2), 3).map(([x, y]) => at([x, y, TERMINAL_H])),
      { size: 0.45 },
    ),
  )
  out.push(
    k.faceTextSvg(k.topMatrix([TERMINAL.x + 8, TERMINAL.y + TERMINAL.d - 7], TERMINAL_H, P, 'x'), 'USDC', {
      size: 2.6,
      tone: 'lo',
    }),
  )
  return out.join('')
}

function chutes() {
  // two troughs from the terminal to the splitter, and from the splitter to the jar and the safe
  const out = []
  const run = (plan) => {
    out.push(S(k.slabOf(plan, 0, 3, P, 2, 0.3), { tone: 'mid' }))
    out.push(L(k.planOutline(k.insetPlan(plan, 1), 3, P, 2), { tone: 'faint' }))
  }
  run({ x: TERMINAL.x + TERMINAL.w, y: -3, w: SPLIT.x - TERMINAL.x - TERMINAL.w, d: 6, r: 1 })
  run({ x: JAR[0] - 3, y: JAR[1] + JAR_R, w: 6, d: SPLIT.y - JAR[1] - JAR_R, r: 1 })
  run({ x: SPLIT.x + SPLIT.w, y: 22, w: SAFE.x - SPLIT.x - SPLIT.w, d: 6, r: 1 })
  run({ x: SPLIT.x + SPLIT.w - 6, y: SPLIT.y + SPLIT.d, w: 6, d: 22 - SPLIT.y - SPLIT.d, r: 1 })
  return out.join('')
}

function splitter() {
  const out = []
  out.push(S(k.slabOf(SPLIT, 0, SPLIT_H, P, 4, 0.5), { tone: 'mid' }))
  const [cx, cy] = [SPLIT.x + SPLIT.w / 2, SPLIT.y + SPLIT.d / 2]
  // the diverter: a vane on a pivot that sends the margin one way and the wholesale the other
  out.push(S(k.cylinder(cx, cy, 4, SPLIT_H, 2.4, P, 24, 0.3), { tone: 'mid' }))
  out.push(L(k.knurl(cx, cy, 4, SPLIT_H, SPLIT_H + 2.4, 20, P), { tone: 'lo' }))
  out.push(
    `<g data-part="vane">${L(k.lineOnTop([cx - 6, cy - 3], [cx + 6, cy + 3], SPLIT_H + 2.6, P), { tone: 'hi' })}</g>`,
  )
  out.push(D([at([cx, cy, SPLIT_H + 2.4])], { size: 0.6, tone: 'hi' }))
  out.push(
    D(
      k.corners(SPLIT, 2.4).map(([x, y]) => at([x, y, SPLIT_H])),
      { size: 0.4 },
    ),
  )
  return out.join('')
}

function jar() {
  const [x, y] = JAR
  const out = [S(k.cylinder(x, y, JAR_R + 1.5, 0, 2, P, 40, 0.4), { tone: 'lo' })]
  out.push(S(k.cylinder(x, y, JAR_R, 2, JAR_H, P, 48, 0.8), { tone: 'mid' }))
  out.push(L([8, 14, 20].map((z) => k.sideArc(x, y, JAR_R, z, P, 24)).join(''), { tone: 'faint' }))
  out.push(S(k.cylinder(x, y, JAR_R + 0.8, JAR_H + 2, 2, P, 48, 0.4), { tone: 'mid' }))
  out.push(L(k.ring(x, y, JAR_R - 2, JAR_H + 4, P, 40), { tone: 'lo' }))
  out.push(
    k.faceTextSvg(k.topMatrix([x, y + 2], JAR_H + 4, P, 'x'), 'HOST', { size: 2.4, tone: 'lo', anchor: 'middle' }),
  )
  return out.join('')
}

function safe() {
  const out = [S(k.slabOf(SAFE, 0, SAFE_H, P, 4, 1), { tone: 'mid' })]
  const top = k.insetPlan(SAFE, 3)
  out.push(L(k.planOutline(top, SAFE_H, P, 4), { tone: 'lo' }))
  // a deposit slot, a combination dial and the hinge pins
  out.push(
    S(k.slabOf({ x: SAFE.x + 6, y: SAFE.y + 6, w: 12, d: 2.6, r: 0.6 }, SAFE_H, 0.4, P, 2), {
      tone: 'lo',
      crease: 'none',
    }),
  )
  const dial = [SAFE.x + SAFE.w - 11, SAFE.y + SAFE.d - 11]
  out.push(S(k.cylinder(dial[0], dial[1], 6.5, SAFE_H, 2.4, P, 40, 0.4), { tone: 'mid' }))
  out.push(L(k.knurl(dial[0], dial[1], 6.5, SAFE_H, SAFE_H + 2.4, 36, P), { tone: 'lo' }))
  const ticks = k.radialTicks(dial[0], dial[1], 5.6, 30, 5, SAFE_H + 2.4, [0.8, 1.5], P)
  out.push(L(ticks.minor, { tone: 'lo' }), L(ticks.major, { tone: 'mid' }))
  out.push(D([at([dial[0], dial[1], SAFE_H + 2.4])], { size: 0.6, tone: 'hi' }))
  out.push(
    D(
      k.corners(top, 2).map(([x, y]) => at([x, y, SAFE_H])),
      { size: 0.45 },
    ),
  )
  out.push(k.faceTextSvg(k.topMatrix([SAFE.x + 6, SAFE.y + 16], SAFE_H, P, 'x'), 'TREASURY', { size: 2.2, tone: 'lo' }))
  return out.join('')
}

function stack() {
  const [x, y] = STACK
  const out = [S(k.cylinder(x, y, 11, 0, 1.6, P, 40, 0.3), { tone: 'lo' })]
  out.push(L(k.ring(x, y, 9, 1.6, P, 40), { tone: 'faint' }))
  for (let i = 0; i < 3; i++)
    out.push(S(k.cylinder(x, y, CHIP_R, 1.6 + i * CHIP_H, CHIP_H, P, 36, 0.2), { tone: 'hi' }))
  out.push(L(k.ring(x, y, CHIP_R - 1.6, 1.6 + 3 * CHIP_H, P, 32), { tone: 'lo' }))
  return out.join('')
}

function tap() {
  const [x, y] = TAP
  const out = []
  out.push(S(k.cylinder(x, y, 16, 0, 3, P, 48, 0.6), { tone: 'lo' }))
  out.push(L(k.ring(x, y, 13, 3, P, 40), { tone: 'faint' }))
  const bolts = [0, 1, 2, 3, 4, 5].map((i) => [
    x + Math.cos((i * Math.PI) / 3) * 14,
    y + Math.sin((i * Math.PI) / 3) * 14,
  ])
  out.push(
    D(
      bolts.map(([bx, by]) => at([bx, by, 3])),
      { size: 0.45 },
    ),
  )
  out.push(S(k.cylinder(x, y, 6, 3, TAP_TOP - 3, P, 36, 0.4), { tone: 'mid', crease: 'none' }))
  out.push(L([18, 36, 54].map((z) => k.sideArc(x, y, 6, z, P, 18)).join(''), { tone: 'faint' }))
  out.push(S(k.cylinder(x, y, 8, TAP_TOP, 6, P, 40, 0.6), { tone: 'mid' }))
  // the spout reaches over the guest's stack
  const arm = { x: x - 3, y: STACK[1] - 2, w: 6, d: y - STACK[1] + 2, r: 2 }
  out.push(S(k.slabOf(arm, TAP_TOP - 8, 6, P, 4, 0.5), { tone: 'mid' }))
  out.push(S(k.cylinder(STACK[0], STACK[1], 3.4, TAP_TOP - 16, 8, P, 24, 0.3), { tone: 'mid' }))
  out.push(L(k.ring(STACK[0], STACK[1], 1.8, TAP_TOP - 16, P, 16), { tone: 'lo' }))
  // the handle, with the ticker engraved on its cap
  out.push(S(k.cylinder(x, y, 2, TAP_TOP + 6, 6, P, 16), { tone: 'mid', crease: 'none' }))
  out.push(S(k.slabOf({ x: x - 5, y: y - 2.5, w: 10, d: 5, r: 1.2 }, TAP_TOP + 12, 14, P, 3, 0.4), { tone: 'hi' }))
  out.push(
    k.faceTextSvg(k.topMatrix([x, y + 0.6], TAP_TOP + 26, P, 'x'), 'TSLA', {
      size: 2.4,
      tone: 'mid',
      anchor: 'middle',
    }),
  )
  return out.join('')
}

const coin = (r, tone = 'hi') => S(k.cylinder(0, 0, r, 0, 1.6, P, 32, 0.2), { tone, lit: tone === 'hi' })
const part = (name, body, z = 0) => `<g data-part="${name}" transform="${k.translateAlong(P, [0, 0, z])}">${body}</g>`

// Back to front, by where each machine stands on the counter.
// Each machine is marked with its stop, so the page can light the one being read.
const at_ = (stop, draw) => () => `<g data-station="${stop}">${draw()}</g>`
const stations = [
  [READER.x + READER.w / 2, 0, () => at_(0, reader)() + part('card', card())],
  [FUNNEL[0], FUNNEL[1], at_(1, terminal)],
  [JAR[0], JAR[1], at_(2, jar)],
  [SPLIT.x, SPLIT.y, at_(2, () => chutes() + splitter())],
  [SAFE.x + SAFE.w / 2, SAFE.y + SAFE.d / 2, at_(2, safe)],
  [STACK[0], STACK[1], at_(3, stack)],
  [TAP[0], TAP[1], at_(3, tap)],
].sort((a, b) => depth(a) - depth(b))

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    'A small bar counter. A card goes into a reader, a USDC coin drops into a terminal, a splitter sends one part to the host’s jar and the rest to the treasury safe, and a tap drops a share chip onto the guest’s stack.',
  body: [
    counter(),
    ...stations.map(([, , draw]) => draw()),
    part('coin', coin(5.5)),
    part('margin', coin(3.6)),
    part('wholesale', coin(4.4, 'mid')),
    part('chip', S(k.cylinder(0, 0, CHIP_R, 0, CHIP_H, P, 36, 0.2), { tone: 'hi', lit: true })),
  ],
})

// Where each moving part travels, as screen vectors per world axis; the page moves them on its clock.
const axes = { x: k.axisVector(P, [1, 0, 0]), y: k.axisVector(P, [0, 1, 0]), z: k.axisVector(P, [0, 0, 1]) }
const PATHS = {
  card: { from: [0, 0, 0], to: [0, 0, -14] },
  coin: { from: [FUNNEL[0], FUNNEL[1], 64], to: [FUNNEL[0], FUNNEL[1], TERMINAL_H + 4] },
  margin: { from: [SPLIT.x + 4, 0, 4], to: [JAR[0], JAR[1], JAR_H + 6] },
  wholesale: { from: [SPLIT.x + 18, 0, 4], to: [SAFE.x + 12, SAFE.y + 7, SAFE_H + 2] },
  chip: { from: [STACK[0], STACK[1], TAP_TOP - 18], to: [STACK[0], STACK[1], 1.6 + 3 * CHIP_H] },
}

writeFileSync(
  new URL('../src/landing/bar-figure.ts', import.meta.url),
  `// Generated by scripts/bar-figure.mjs (the anatomy kit, MIT). Do not edit by hand: change the script and run it.\n` +
    `export const BAR_SVG = ${JSON.stringify(svg)}\n` +
    `export const BAR_AXES = ${JSON.stringify(axes)} as const\n` +
    `export const BAR_PATHS = ${JSON.stringify(PATHS)} as const\n`,
)
console.log(`bar-figure: ${(svg.length / 1024).toFixed(1)} KB of SVG`)

// Fig. 1 on the landing: the bar a drink goes through (scripts/bar-figure.mjs builds the drawing). The stop being read
// in "One drink, four stops" plays on the machine: the card goes in, the coin drops, the splitter sends the margin to
// the host's jar and the wholesale to the treasury, and the tap drops a share chip onto the guest's stack. The SVG
// loads when the section comes near, so the first screen stays light.
import { gsap } from 'gsap'
import { useEffect, useRef } from 'react'
import './iso.css'

export const STOP_LINES = [
  'Sign in · Privy NEAR account',
  'Order · USDC, gas paid by the relayer',
  'Split · margin to the host, wholesale to the treasury',
  'Settle · 0.001 TSLA, NEP-245',
]

type Vec = readonly [number, number, number]
const ease = gsap.parseEase('power3.inOut')
const clamp = (v: number) => Math.min(1, Math.max(0, v))

/** The figure card; `active` is the stop being read (-1 before any). */
export function BarFigure({ active }: { active: { current: number } }) {
  const box = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = box.current!
    let alive = true
    let stop = () => {}
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return
        io.disconnect()
        void import('./bar-figure.ts').then(({ BAR_SVG, BAR_AXES, BAR_PATHS }) => {
          if (!alive) return
          el.innerHTML = BAR_SVG
          stop = run(el, BAR_AXES, BAR_PATHS)
        })
      },
      { rootMargin: '600px' },
    )
    io.observe(el)

    function run(
      root: HTMLElement,
      axes: { x: readonly number[]; y: readonly number[]; z: readonly number[] },
      paths: Record<string, { from: Vec; to: Vec }>,
    ) {
      const part = (n: string) => root.querySelector<SVGGElement>(`[data-part="${n}"]`)!
      const parts = {
        card: part('card'),
        coin: part('coin'),
        margin: part('margin'),
        wholesale: part('wholesale'),
        chip: part('chip'),
      }
      const led = part('led').querySelector('circle')!
      const place = (name: keyof typeof parts, t: number, alpha = 1) => {
        const { from, to } = paths[name]!
        const w = from.map((f, i) => f + (to[i]! - f) * t)
        const x = w[0]! * axes.x[0]! + w[1]! * axes.y[0]! + w[2]! * axes.z[0]!
        const y = w[0]! * axes.x[1]! + w[1]! * axes.y[1]! + w[2]! * axes.z[1]!
        parts[name].setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
        parts[name].style.opacity = String(alpha)
      }
      // One pose per stop, at local time u (0..1, looping): the stops before it are done, the ones after not started.
      const pose = (stop: number, u: number) => {
        const done = (i: number) => stop > i
        const now = (i: number) => stop === i
        place('card', done(0) ? 1 : now(0) ? ease(clamp(u / 0.45)) : 0)
        led.style.fill = done(0) || (now(0) && u > 0.45) ? 'var(--color-neon)' : ''
        led.setAttribute('r', done(0) || (now(0) && u > 0.45) ? '1.6' : '1.1')
        const fall = now(1) ? clamp(u / 0.55) : 0
        place('coin', gsap.parseEase('power2.in')(fall), now(1) ? 1 - clamp((u - 0.5) / 0.15) : 0)
        const split = now(2) ? ease(clamp(u / 0.7)) : 0
        const splitAlpha = now(2) ? clamp(u / 0.08) * (1 - clamp((u - 0.68) / 0.12)) : 0
        place('margin', split, splitAlpha)
        place('wholesale', split, splitAlpha)
        const drop = now(3) ? gsap.parseEase('bounce.out')(clamp(u / 0.6)) : 0
        place('chip', drop, now(3) ? 1 : 0)
      }
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches
      let shown = -2
      let since = 0
      const say = (i: number) => {
        if (i === shown) return
        shown = i
        since = gsap.ticker.time
        readout.current!.textContent = i < 0 ? 'Scroll the stops' : `${i + 1} · ${STOP_LINES[i]}`
      }
      if (still) {
        pose(3, 1)
        say(3)
        return () => {}
      }
      let visible = true
      const vio = new IntersectionObserver(([e]) => (visible = Boolean(e?.isIntersecting)))
      vio.observe(root)
      const tick = (t: number) => {
        if (!visible) return
        // Before any stop is read, the machine runs the whole drink on its own.
        const i = active.current
        if (i < 0) {
          const cycle = (t % 10) / 2.5
          say(-1)
          return pose(Math.floor(cycle), cycle % 1)
        }
        say(i)
        pose(i, ((t - since) % 2.6) / 2.6)
      }
      pose(0, 0)
      gsap.ticker.add(tick)
      return () => {
        gsap.ticker.remove(tick)
        vio.disconnect()
      }
    }

    return () => {
      alive = false
      io.disconnect()
      stop()
    }
  }, [active])

  return (
    <figure className="iso bar-plate">
      <figcaption className="plate-top">
        <span>Fig 1</span>
        <span>The bar</span>
      </figcaption>
      <div ref={box} className="bar-art" />
      <div className="plate-bottom">
        <span className="plate-hint">Point at a stop</span>
        <p ref={readout} data-readout aria-live="off">
          Scroll the stops
        </p>
      </div>
    </figure>
  )
}

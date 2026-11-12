// The landing's one clock (gsap.ticker): smooth scroll, the stairs clip scrubbed by the scroll position, the night
// clock in the top bar, reveals, counters, the button fill and the door previews. See DESIGN.md.
import { gsap } from 'gsap'
import Lenis from 'lenis'

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const touch = () => matchMedia('(hover: none)').matches
const clamp = (v: number) => Math.min(1, Math.max(0, v))

let settledOnce: Promise<void> | undefined
/** Resolves once the page has loaded and settled, so clips never compete with what the first screen needs. */
const settled = () =>
  (settledOnce ??= new Promise<void>((done) => {
    const go = () => setTimeout(done, 1200)
    if (document.readyState === 'complete') go()
    else addEventListener('load', go, { once: true })
  }))

// The night runs from doors at 22:00 to closing at 04:00. Each part of the page carries its time (`data-at`) and
// what is happening then (`data-label`); the clock runs between them as the reading line passes.
const minutesOf = (at: string) => {
  const [h, m] = at.split(':').map(Number) as [number, number]
  return (h < 12 ? h + 24 : h) * 60 + m // past midnight is still the same night
}
const timeOf = (minutes: number) => {
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0')
  const mm = String(Math.floor((minutes % 60) / 5) * 5).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Starts everything that moves on the landing; returns the cleanup. */
export function startLanding(root: HTMLElement) {
  const still = reduced()
  const off: (() => void)[] = []
  const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
    addEventListener(t, f, o)
    off.push(() => removeEventListener(t, f, o))
  }

  // Smooth scroll on the shared ticker. Not under reduced motion.
  let lenis: Lenis | undefined
  const raf = (t: number) => lenis?.raf(t * 1000)
  if (!still) {
    lenis = new Lenis({ autoRaf: false, anchors: true })
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)
  }

  // The stairs clip: loaded after the page settles, never played, only scrubbed. SD on phones and Save-Data.
  const track = root.querySelector<HTMLElement>('[data-track]')!
  const clip = track.querySelector<HTMLVideoElement>('video')!
  const sd = innerWidth <= 900 || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData
  let alive = true
  if (!still)
    void settled().then(() => {
      if (!alive) return
      clip.src = sd ? clip.dataset.sd! : clip.dataset.hd!
      clip.load()
    })
  let cur = 0
  const seek = (t: number) => {
    if (clip.readyState < 1 || clip.seeking) return
    if (Math.abs(clip.currentTime - t) > 1 / 60) clip.currentTime = t
  }
  const onSeeked = () => seek(cur)
  clip.addEventListener('seeked', onSeeked)
  off.push(() => clip.removeEventListener('seeked', onSeeked))

  // The clock and the top bar narrate where in the night the page is.
  const time = root.querySelector<HTMLElement>('[data-clock]')!
  const label = root.querySelector<HTMLElement>('[data-clock-label]')!
  const bar = root.querySelector<HTMLElement>('[data-bar]')!
  let shown = ''
  let marks: { y: number; minutes: number; label: string }[] = []
  const measure = () => {
    const top = lenis?.scroll ?? scrollY
    marks = [...root.querySelectorAll<HTMLElement>('[data-at]')]
      .map((el) => ({
        y: el.getBoundingClientRect().top + top,
        minutes: minutesOf(el.dataset.at!),
        label: el.dataset.label!,
      }))
      .sort((a, b) => a.y - b.y)
  }
  measure()
  const ro = new ResizeObserver(measure)
  ro.observe(document.body)
  off.push(() => ro.disconnect())
  // The clock reads the same as the stamp of the part being read; it ticks forward between parts.
  const clockAtY = (line: number) => {
    const at = [...marks].reverse().find((m) => m.y <= line) ?? marks[0]
    return at ? { time: timeOf(at.minutes), label: at.label } : { time: '22:00', label: 'Doors open' }
  }

  const tick = (t: number) => {
    const y = lenis?.scroll ?? scrollY
    const bottom = y >= document.documentElement.scrollHeight - innerHeight - 2
    const c = clockAtY(bottom ? Infinity : y + innerHeight * 0.6)
    if (c.time + c.label !== shown) {
      shown = c.time + c.label
      time.textContent = c.time
      label.textContent = c.label
    }
    bar.classList.toggle('is-scrolled', y > 40)
    // The bar's Launch app joins once the hero's own has scrolled away.
    bar.classList.toggle('is-past', y > innerHeight * 0.7)

    const span = track.offsetHeight - innerHeight
    const p = clamp((y - track.offsetTop) / Math.max(1, span))
    track.style.setProperty('--p', p.toFixed(4))
    if (still || !clip.duration || y > track.offsetTop + track.offsetHeight) return
    // The smoke keeps drifting at rest: a slow breath of a few frames around the scroll position.
    const breath = (Math.sin(t * 0.7) * 0.5 + 0.5) * 0.18
    const want = Math.min(clip.duration - 1 / 48, p * (clip.duration - 0.25) + breath)
    cur += (want - cur) * 0.2
    seek(cur)
  }
  gsap.ticker.add(tick)
  off.push(() => gsap.ticker.remove(tick))

  // Reveals and counters switch on once, as they come on screen.
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target as HTMLElement
        el.classList.add('in')
        io.unobserve(el)
        const to = Number(el.dataset.count)
        if (!Number.isNaN(to) && el.dataset.count !== undefined && !still) {
          const n = { v: 0 }
          const dp = Number(el.dataset.dp ?? 0)
          gsap.to(n, {
            v: to,
            duration: 1.6,
            ease: 'expo.out',
            onUpdate: () => (el.textContent = n.v.toFixed(dp)),
          })
        }
      }),
    // switched on once well inside the frame, never while cut by its bottom edge
    { threshold: 0.2, rootMargin: '0px 0px -12% 0px' },
  )
  root.querySelectorAll('[data-reveal]:not(.beat), [data-count]').forEach((el) => io.observe(el))
  off.push(() => io.disconnect())
  // The night's beats on the stairs are lit only while they are well inside the frame, never under the top bar.
  const bio = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)),
    { rootMargin: '-16% 0px -14% 0px' },
  )
  root.querySelectorAll('.beat').forEach((el) => bio.observe(el))
  off.push(() => bio.disconnect())

  // Looping clips (the floor, the bar): load after the page settles and play only on screen.
  const loops = [...root.querySelectorAll<HTMLVideoElement>('video[data-loop]')]
  const lio = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        const v = e.target as HTMLVideoElement
        if (!e.isIntersecting) return v.pause()
        void settled().then(() => {
          if (!alive || still) return
          if (!v.src) v.src = v.dataset.src!
          void v.play().catch(() => {})
        })
      }),
    { rootMargin: '200px' },
  )
  loops.forEach((v) => lio.observe(v))
  off.push(() => lio.disconnect())

  // Primary buttons fill from the side the pointer comes in (CSS covers touch, keyboard and reduced motion).
  if (!touch() && !still)
    root.querySelectorAll<HTMLElement>('[data-fill]').forEach((btn) => {
      const fill = btn.querySelector<HTMLElement>('.fill')!
      const at = (e: PointerEvent) => {
        const r = btn.getBoundingClientRect()
        return `${e.clientX - r.left}px ${e.clientY - r.top}px`
      }
      const enter = (e: PointerEvent) => {
        gsap.set(fill, { clipPath: `circle(0% at ${at(e)})` })
        btn.classList.add('is-filled')
        gsap.to(fill, { clipPath: `circle(150% at ${at(e)})`, duration: 0.55, ease: 'expo.out', overwrite: true })
      }
      const leave = (e: PointerEvent) => {
        btn.classList.remove('is-filled')
        gsap.to(fill, { clipPath: `circle(0% at ${at(e)})`, duration: 0.45, ease: 'expo.out', overwrite: true })
      }
      btn.addEventListener('pointerenter', enter)
      btn.addEventListener('pointerleave', leave)
      off.push(() => {
        btn.removeEventListener('pointerenter', enter)
        btn.removeEventListener('pointerleave', leave)
      })
    })

  // The doors: the screen behind each one follows the pointer over the list (desktop only).
  const list = root.querySelector<HTMLElement>('[data-doors]')
  const peek = root.querySelector<HTMLElement>('[data-peek]')
  if (list && peek && !touch()) {
    const img = peek.querySelector('img')!
    const x = gsap.quickTo(peek, 'x', { duration: 0.6, ease: 'power3.out' })
    const yq = gsap.quickTo(peek, 'y', { duration: 0.6, ease: 'power3.out' })
    const rot = gsap.quickTo(peek, 'rotate', { duration: 0.8, ease: 'power3.out' })
    let last = 0
    let px = -1
    let py = -1
    const hide = () => gsap.to(peek, { autoAlpha: 0, scale: 0.85, duration: 0.4, ease: 'expo.out' })
    on('pointermove', (e) => {
      px = e.clientX
      py = e.clientY
      x(px)
      yq(py)
      rot(still ? 0 : gsap.utils.clamp(-10, 10, (px - last) * 0.5))
      last = px
    })
    list.querySelectorAll<HTMLAnchorElement>('a[data-peek-src]').forEach((a) => {
      const show = () => {
        img.src = a.dataset.peekSrc!
        gsap.to(peek, { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'expo.out' })
      }
      a.addEventListener('pointerenter', show)
      off.push(() => a.removeEventListener('pointerenter', show))
    })
    list.addEventListener('pointerleave', hide)
    off.push(() => list.removeEventListener('pointerleave', hide))
    // The page can scroll out from under a still pointer without a pointerleave: checked on the clock.
    let lastY = 0
    const check = () => {
      const y = lenis?.scroll ?? scrollY
      if (y === lastY || px < 0) return
      lastY = y
      if (!list.contains(document.elementFromPoint(px, py))) hide()
    }
    gsap.ticker.add(check)
    off.push(() => gsap.ticker.remove(check))
  }

  return () => {
    alive = false
    off.forEach((f) => f())
    gsap.ticker.remove(raf)
    lenis?.destroy()
  }
}

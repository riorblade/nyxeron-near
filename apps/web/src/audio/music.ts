// Club music: the lounge track outside the club, the DJ crate inside it, and the beat the venue dances to.
// One <audio> element, routed through Web Audio (an analyser reads the kick) once the player has touched the page.
// Browsers decide when sound may start: it is tried at once (a browser that trusts this site lets it play), again on
// the first scroll, and for sure on the first pointer or key press. The mute choice is remembered in this browser.
import { useEffect, useSyncExternalStore } from 'react'
import { BeatTracker } from './beat.ts'

export type MusicMode = 'off' | 'lounge' | 'club'
export const LOUNGE = { file: 'landing', title: 'NYXERON Lounge' }
export const CRATE = [
  { file: 'shakalaka-boom', title: 'Shakalaka Boom' },
  { file: 'papi-jarang-pulang', title: 'Papi Jarang Pulang' },
  { file: 'dj-main-serong', title: 'DJ Main Serong' },
]
const MUTE_KEY = 'nyxeron.muted.v1'

let mode: MusicMode = 'off'
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
})()
let track = -1 // index in CRATE while in the club
let el: HTMLAudioElement | undefined
let ctx: AudioContext | undefined
let analyser: AnalyserNode | undefined
let bins: Uint8Array<ArrayBuffer> | undefined
let unlocked = false
const beat = new BeatTracker()
const listeners = new Set<() => void>()
let snapshot: { mode: MusicMode; muted: boolean; title: string; playing: boolean } = {
  mode,
  muted,
  title: '',
  playing: false,
}
const emit = () => {
  snapshot = { mode, muted, title: nowPlaying(), playing: Boolean(el && !el.paused) }
  for (const l of listeners) l()
}

function nowPlaying() {
  if (mode === 'club' && track >= 0) return CRATE[track]!.title
  if (mode === 'lounge') return LOUNGE.title
  return ''
}

function setup() {
  if (el) return el
  el = new Audio()
  el.preload = 'auto'
  el.addEventListener('ended', () => {
    if (mode === 'club') next()
  })
  el.addEventListener('play', emit)
  el.addEventListener('pause', emit)
  return el
}

// An AudioContext made before a tap stays suspended and would silence the element routed through it, so Web Audio
// joins only after the first tap.
function route() {
  if (ctx || !el) return
  try {
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0
    bins = new Uint8Array(analyser.frequencyBinCount)
    ctx.createMediaElementSource(el).connect(analyser).connect(ctx.destination)
  } catch {
    // No Web Audio: the music still plays, the venue keeps its own clock.
  }
}

function load(file: string, loop: boolean) {
  const a = setup()
  a.loop = loop
  a.src = `/audio/${file}.mp3`
}

function next() {
  track = (track + 1) % CRATE.length
  load(CRATE[track]!.file, false)
  play()
  emit()
}

function play() {
  if (!el || muted || mode === 'off') return
  if (unlocked) route()
  void ctx?.resume()
  // Before a tap this only works where the browser already trusts the site; otherwise the tap retries it.
  void el.play().catch(() => {})
}

function apply() {
  if (mode === 'off' || muted) el?.pause()
  if (mode === 'club') {
    // A fresh night starts on a random track of the crate.
    if (track < 0) {
      track = Math.floor(Math.random() * CRATE.length) - 1
      return next()
    }
  } else if (mode === 'lounge') {
    if (!el?.src.endsWith(`/${LOUNGE.file}.mp3`)) load(LOUNGE.file, true)
  }
  play()
  emit()
}

/** Which music this screen wants; the last screen to ask wins. */
export function useMusic(want: MusicMode) {
  useEffect(() => {
    if (want === mode) return
    if (mode === 'club') track = -1 // a new night starts on a fresh track
    mode = want
    apply()
  }, [want])
}

export function setMuted(m: boolean) {
  muted = m
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0')
  } catch {
    // Storage unavailable: the choice lasts for this visit.
  }
  apply()
}

export function useMusicState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
    () => snapshot,
  )
}

// Sound is sure to start once the player has touched the page; a first scroll tries it too.
if (typeof window !== 'undefined') {
  const unlock = () => {
    unlocked = true
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('touchend', unlock)
    apply()
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
  window.addEventListener('touchend', unlock)
  window.addEventListener('scroll', () => play(), { once: true, passive: true })
}

/** What the 3D venue reads every frame (see venue/scene3d.ts). */
export const audio = {
  get live() {
    return mode === 'club' && !muted && Boolean(el && !el.paused && analyser)
  },
  get intensity() {
    return beat.intensity
  },
  get dropAt() {
    return beat.dropAt
  },
  pulse() {
    if (!analyser || !bins) return 0
    analyser.getByteFrequencyData(bins)
    let bass = 0
    let all = 0
    for (let i = 0; i < bins.length; i++) {
      if (i >= 1 && i <= 6) bass += bins[i]!
      all += bins[i]!
    }
    const t = performance.now()
    beat.update(bass / 6 / 255, all / bins.length / 255, t)
    return beat.pulse(t)
  },
  /** A short register blip when a drink sells. */
  cash() {
    if (!ctx || muted || mode !== 'club' || ctx.state !== 'running') return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 1320
    g.gain.setValueAtTime(0.04, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.2)
  },
}

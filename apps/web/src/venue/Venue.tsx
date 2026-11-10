// The 3D club as a React component (the venue from our earlier prototype, see scene3d.ts). It only reads the night:
// the game rules live in @nyxeron/game, and legacy.ts dresses the Night up as the state the venue draws.
import type { Market, Night } from '@nyxeron/game'
import { SAMPLE_MARKET } from '../practice/market.ts'
import { useEffect, useRef, useState } from 'react'
import type { CamMode } from './camera.ts'
import { type GameState, previewState, toGameState } from './legacy.ts'
import type { Emote } from './moves.ts'
import { VenueScene } from './scene3d.ts'

/** `night` null = a lively preview of the level (the picker), priced from `market`. */
export function Venue({
  level,
  night = null,
  market = SAMPLE_MARKET,
  me,
  cam = 'behind',
  emote = null,
  className,
}: {
  level: number
  night?: Night | null
  market?: Market
  /** This player walks the club as their own avatar (WASD / the stick). Cosmetic only. */
  me?: { name: string; avatar: number }
  cam?: CamMode
  emote?: Emote | null
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<VenueScene | null>(null)
  const latest = useRef<GameState>(previewState(level, market))
  const [noGl, setNoGl] = useState(false)
  const base = night ? toGameState(night, level) : previewState(level, market)
  latest.current =
    me && base.night ? { ...base, night: { ...base.night, visitors: { me: { ...me, cash: 0, holdings: {} } } } } : base
  const walk = useRef({ me, cam, emote })
  walk.current = { me, cam, emote }
  const live = night !== null
  const liveRef = useRef(live)
  liveRef.current = live

  useEffect(() => {
    let cancelled = false
    const v = new VenueScene()
    v.init(host.current!)
      .then(() => {
        // StrictMode mounts twice: a scene torn down before it loaded must not become current.
        if (cancelled) return
        scene.current = v
        v.setScreenPrefs({ clips: 'peak', ads: false })
        // Fire and fog on the kick while a night is live; the picker's preview stays calm.
        v.setPyroAuto(liveRef.current)
        v.update(latest.current)
        applyWalk(v, walk.current)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        console.warn('venue: 3D view unavailable', e)
        setNoGl(true)
      })
    return () => {
      cancelled = true
      scene.current = null
      v.destroy()
    }
  }, [])

  // The preview changes with the level and the market; a live night every game minute.
  useEffect(() => {
    scene.current?.update(latest.current)
  }, [night, level, market, me?.name, me?.avatar])
  useEffect(() => {
    if (scene.current) applyWalk(scene.current, walk.current)
  }, [me?.name, me?.avatar, cam, emote])
  useEffect(() => {
    scene.current?.setPyroAuto(live)
  }, [live])

  return (
    <div ref={host} className={className ?? 'relative h-full w-full'}>
      {noGl && (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
          This browser can&apos;t show the 3D club (WebGL is off). The night still runs.
        </p>
      )}
    </div>
  )
}

function applyWalk(v: VenueScene, w: { me?: unknown; cam: CamMode; emote: Emote | null }) {
  v.setMe(w.me ? 'me' : '')
  v.setControl(Boolean(w.me))
  if (w.me) v.setCameraMode(w.cam)
  v.setEmote(w.emote)
}

// The 3D club as a React component. It only reads the night; the game rules live in @nyxeron/game.
import type { Night } from '@nyxeron/game'
import { useEffect, useRef } from 'react'
import { VenueScene } from './scene.ts'

export function Venue({ level, night = null, className }: { level: number; night?: Night | null; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<VenueScene>(undefined)

  useEffect(() => {
    const s = new VenueScene(host.current!)
    scene.current = s
    return () => {
      s.dispose()
      scene.current = undefined
    }
  }, [])
  useEffect(() => scene.current?.setLevel(level), [level])
  useEffect(() => scene.current?.update(night), [night])

  return <div ref={host} className={className ?? 'h-full w-full'} />
}

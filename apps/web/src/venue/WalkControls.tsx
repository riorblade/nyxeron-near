// What a guest needs to walk the club: the camera, a dance, the on-screen stick on touch screens, and the way back.
import { useRef, useState } from 'react'
import { CAM_MODES, type CamMode } from './camera.ts'
import { type Emote, EMOTES } from './moves.ts'
import { stick } from './stick.ts'

const CAM_LABEL: Record<CamMode, string> = { behind: 'Behind', eyes: 'Eyes', drone: 'Drone', show: 'Show' }
const EMOTE_LABEL: Record<Emote, string> = {
  bounce: 'Bounce',
  pump: 'Pump',
  sway: 'Sway',
  handsUp: 'Hands up',
  twoStep: 'Two-step',
  groove: 'Groove',
  shuffle: 'Shuffle',
  jump: 'Jump',
  makeItRain: 'Make it rain',
  tokenToss: 'Token toss',
}

export function WalkControls(props: {
  cam: CamMode
  onCam: (c: CamMode) => void
  emote: Emote | null
  onEmote: (e: Emote | null) => void
  onExit: () => void
}) {
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur ${on ? 'border-gold bg-gold text-night' : 'border-line bg-panel/80 text-ink hover:border-gold'}`
  return (
    <>
      <div className="fixed inset-x-3 top-3 z-50 flex flex-wrap items-center justify-between gap-2">
        <button onClick={props.onExit} className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-night">
          ← Back to the bar
        </button>
        <div className="flex gap-1.5" role="group" aria-label="Camera">
          {CAM_MODES.map((c) => (
            <button
              key={c}
              onClick={() => props.onCam(c)}
              aria-pressed={props.cam === c}
              className={chip(props.cam === c)}
            >
              {CAM_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="fixed inset-x-3 bottom-14 z-50 flex flex-col items-end gap-2">
        <p className="hidden rounded-lg bg-panel/80 px-3 py-1.5 text-xs text-muted backdrop-blur md:block">
          WASD or arrows to walk · Shift to run · drag to look around
        </p>
        <div
          className="flex max-w-full gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:justify-end"
          role="group"
          aria-label="Dance"
        >
          {EMOTES.map((e) => (
            <button
              key={e}
              onClick={() => props.onEmote(props.emote === e ? null : e)}
              aria-pressed={props.emote === e}
              className={`shrink-0 ${chip(props.emote === e)}`}
            >
              {EMOTE_LABEL[e]}
            </button>
          ))}
        </div>
      </div>
      <Stick />
    </>
  )
}

/** Touch screens only: drag inside the ring to walk; past the edge is a run. */
function Stick() {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const id = useRef<number | null>(null)
  const move = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current || !base.current) return
    const r = base.current.getBoundingClientRect()
    const R = r.width / 2
    let x = (e.clientX - r.left - R) / R
    let y = (e.clientY - r.top - R) / R
    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    stick.x = x
    stick.y = -y
    setKnob({ x: x * R * 0.6, y: y * R * 0.6 })
  }
  const end = () => {
    id.current = null
    stick.x = stick.y = 0
    setKnob({ x: 0, y: 0 })
  }
  return (
    <div
      ref={base}
      aria-hidden
      className="pointer-coarse:block fixed bottom-32 left-6 z-50 hidden size-32 touch-none rounded-full border border-line bg-panel/50 backdrop-blur"
      onPointerDown={(e) => {
        id.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e)
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="absolute top-1/2 left-1/2 size-12 rounded-full bg-gold/80"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  )
}

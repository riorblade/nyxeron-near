import { setMuted, useMusicState } from './music.ts'

/** Mute / unmute, and what is playing. Bottom-left on every screen with music. */
export function MusicToggle() {
  const { mode, muted, title } = useMusicState()
  if (mode === 'off') return null
  return (
    <button
      onClick={() => setMuted(!muted)}
      aria-pressed={!muted}
      aria-label={muted ? 'Turn music on' : 'Turn music off'}
      className="fixed bottom-3 left-3 z-50 flex max-w-[70vw] items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1.5 text-xs text-muted backdrop-blur hover:text-ink"
    >
      <span aria-hidden className={muted ? '' : 'text-neon'}>
        {muted ? '♪̸' : '♪'}
      </span>
      <span className="truncate">{muted ? 'Music off' : title || 'Tap anywhere for music'}</span>
    </button>
  )
}

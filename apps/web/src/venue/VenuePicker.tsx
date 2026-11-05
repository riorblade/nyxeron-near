// Pick tonight's venue: The Basement at each level, ← → to browse, a padlock on what the reputation hasn't unlocked.
import { rules, venueFor } from '@nyxeron/game'
import { useState } from 'react'
import { Venue } from './Venue.tsx'

export function VenuePicker({ reputation, onOpen }: { reputation: number; onOpen: (level: number) => void }) {
  const unlocked = venueFor(reputation).level
  const [level, setLevel] = useState<number>(unlocked)
  const venue = rules.VENUES[level - 1]!
  const locked = level > unlocked
  const go = (d: number) => setLevel((l) => Math.min(rules.VENUES.length, Math.max(1, l + d)))

  return (
    <section className="relative h-[70vh] min-h-96 overflow-hidden rounded-2xl border border-line bg-night">
      <Venue
        level={level}
        className={`h-full w-full transition ${locked ? 'opacity-50 grayscale brightness-75' : ''}`}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <span className="text-lg font-black tracking-widest text-neon lowercase">nyxeron</span>
        <span className="rounded-full bg-panel/80 px-3 py-1 text-xs text-muted">Drag to look around</span>
      </div>

      <button
        aria-label="Previous venue"
        disabled={level === 1}
        onClick={() => go(-1)}
        className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-panel/80 p-3 text-2xl disabled:opacity-20"
      >
        ←
      </button>
      <button
        aria-label="Next venue"
        disabled={level === rules.VENUES.length}
        onClick={() => go(1)}
        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-panel/80 p-3 text-2xl disabled:opacity-20"
      >
        →
      </button>

      {locked && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <span className="text-6xl" aria-hidden>
            🔒
          </span>
          <p className="font-semibold">Locked</p>
          <p className="text-sm text-muted">Reach reputation {venue.reputation} to unlock</p>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-4">
        <div className="text-center">
          <h2 className="text-2xl font-black">Venue level {level}</h2>
          <p className="text-sm text-muted">
            The Basement · {venue.capacity} guests
            {level === unlocked ? ' · your biggest room' : ''}
          </p>
        </div>
        <div className="flex gap-1.5" aria-hidden>
          {rules.VENUES.map((v) => (
            <span key={v.level} className={`h-1.5 w-6 rounded-full ${v.level === level ? 'bg-neon' : 'bg-line'}`} />
          ))}
        </div>
        <button
          disabled={locked}
          onClick={() => onOpen(level)}
          className="w-full max-w-md rounded-xl bg-gold py-3 text-lg font-black text-night disabled:opacity-40"
        >
          {locked ? 'Locked' : 'Open the doors'}
        </button>
      </div>
    </section>
  )
}

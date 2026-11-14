// The 3D club behind a City party (venue/Venue.tsx, from #50). three.js is big, so it loads with the party page only;
// without WebGL or if the chunk fails, the page stays as it is over the plain background.
import type { Market } from '@nyxeron/game'
import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { loadMarket } from '../practice/market.ts'
import type { CamMode } from '../venue/camera.ts'
import type { Emote } from '../venue/moves.ts'
import { WalkControls } from '../venue/WalkControls.tsx'

const Venue = lazy(() => import('../venue/Venue.tsx').then((m) => ({ default: m.Venue })))

class NoVenue extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** A live City party has no simulated night, so the club shows its lively preview crowd, priced from today's market. */
/** `walk`: the guest walks the club as their own avatar (the same scene, so nothing reloads). */
export function ClubBackdrop(props: {
  level: number
  walk?: { name: string; onExit: () => void }
  /** The host's moves running now, and when the last pyro went off (ms). */
  moves?: string[]
  pyroAt?: number | null
}) {
  const [market, setMarket] = useState<Market>()
  const [cam, setCam] = useState<CamMode>('behind')
  const [emote, setEmote] = useState<Emote | null>(null)
  useEffect(() => {
    void loadMarket().then((m) => setMarket(m.market))
  }, [])
  const walk = props.walk
  const me = walk ? { name: walk.name, avatar: avatarFor(walk.name) } : undefined
  return (
    <div
      className={walk ? 'fixed inset-0 z-40 bg-night' : 'pointer-events-none fixed inset-0 -z-10'}
      aria-hidden={!walk}
    >
      <NoVenue>
        <Suspense fallback={null}>
          {market && (
            <Venue
              level={props.level}
              market={market}
              me={me}
              cam={cam}
              emote={emote}
              moves={props.moves}
              pyroAt={props.pyroAt}
              onShowEnd={() => setCam('drone')}
            />
          )}
        </Suspense>
      </NoVenue>
      {walk ? (
        <WalkControls cam={cam} onCam={setCam} emote={emote} onEmote={setEmote} onExit={walk.onExit} />
      ) : (
        // Keeps the menu readable over the lights while the room stays visible in the middle.
        <div className="cy-club-shade absolute inset-0" />
      )}
    </div>
  )
}

/** One of the venue's ten guest looks, the same one every time for a name. */
const avatarFor = (name: string) => (Array.from(name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 10) + 1

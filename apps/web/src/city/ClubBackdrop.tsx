// The 3D club behind a City party (venue/Venue.tsx, from #50). three.js is big, so it loads with the party page only;
// without WebGL or if the chunk fails, the page stays as it is over the plain background.
import type { Market } from '@nyxeron/game'
import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { loadMarket } from '../practice/market.ts'

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
export function ClubBackdrop({ level }: { level: number }) {
  const [market, setMarket] = useState<Market>()
  useEffect(() => {
    void loadMarket().then((m) => setMarket(m.market))
  }, [])
  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
      <NoVenue>
        <Suspense fallback={null}>{market && <Venue level={level} market={market} />}</Suspense>
      </NoVenue>
      {/* Keeps the menu readable over the lights. */}
      <div className="absolute inset-0 bg-gradient-to-b from-night/80 via-night/35 to-night/85" />
    </div>
  )
}

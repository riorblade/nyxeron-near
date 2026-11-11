import './index.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { MusicToggle } from './audio/MusicToggle.tsx'
import { type MusicMode, useMusic } from './audio/music.ts'
import { Landing } from './landing/Landing.tsx'
import { usePath } from './router.tsx'
import { isLandingHost } from './site.ts'

// Screens that need sign-in load Privy with them. Only the landing is in the first chunk, so nyxeron.xyz stays light.
const AppHome = lazy(() => import('./landing/AppHome.tsx').then((m) => ({ default: m.AppHome })))
const Practice = lazy(() => import('./practice/Practice.tsx').then((m) => ({ default: m.Practice })))
const Proof = lazy(() => import('./proof/Proof.tsx').then((m) => ({ default: m.Proof })))
const SpikeRoute = lazy(() => import('./spike/SpikeRoute.tsx'))
const CityRoute = lazy(() => import('./city/CityRoute.tsx'))
const AdminRoute = lazy(() => import('./admin/AdminRoute.tsx'))

// Practice picks its own music (lounge on the menus, the DJ crate during a night).
const musicFor = (path: string): MusicMode | null =>
  path.startsWith('/practice')
    ? null
    : path.startsWith('/city/party')
      ? 'club'
      : path.startsWith('/admin') || path.startsWith('/proof') || path.startsWith('/spike')
        ? 'off'
        : 'lounge'

function Music() {
  const want = musicFor(usePath())
  return want ? <Want mode={want} /> : null
}
function Want({ mode }: { mode: MusicMode }) {
  useMusic(mode)
  return null
}

function App() {
  const path = usePath()
  // nyxeron.xyz shows only the landing (vercel.json sends app paths to app.nyxeron.xyz).
  if (isLandingHost() || path.startsWith('/landing')) return <Landing />
  return (
    <Suspense fallback={null}>
      {path.startsWith('/practice') ? (
        <Practice />
      ) : path.startsWith('/proof') ? (
        <Proof />
      ) : path.startsWith('/admin') ? (
        <AdminRoute />
      ) : path.startsWith('/city') ? (
        <CityRoute />
      ) : path.startsWith('/spike') ? (
        <SpikeRoute />
      ) : (
        <AppHome />
      )}
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Music />
    <MusicToggle />
  </StrictMode>,
)

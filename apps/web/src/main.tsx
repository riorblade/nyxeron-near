import './index.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { MusicToggle } from './audio/MusicToggle.tsx'
import { type MusicMode, useMusic } from './audio/music.ts'
import { AppHome } from './landing/AppHome.tsx'
import { Landing } from './landing/Landing.tsx'
import { Practice } from './practice/Practice.tsx'
import { Proof } from './proof/Proof.tsx'
import { usePath } from './router.tsx'
import { isLandingHost } from './site.ts'

// Screens that need sign-in load Privy with them; Practice and the landing stay light.
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
  if (path.startsWith('/practice')) return <Practice />
  if (path.startsWith('/proof')) return <Proof />
  if (path.startsWith('/admin'))
    return (
      <Suspense fallback={null}>
        <AdminRoute />
      </Suspense>
    )
  if (path.startsWith('/city'))
    return (
      <Suspense fallback={null}>
        <CityRoute />
      </Suspense>
    )
  if (path.startsWith('/spike'))
    return (
      <Suspense fallback={null}>
        <SpikeRoute />
      </Suspense>
    )
  return <AppHome />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Music />
    <MusicToggle />
  </StrictMode>,
)

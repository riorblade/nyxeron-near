import './index.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Landing } from './landing/Landing.tsx'
import { Practice } from './practice/Practice.tsx'
import { Proof } from './proof/Proof.tsx'
import { usePath } from './router.tsx'

// Screens that need sign-in load Privy with them; Practice and the landing stay light.
const SpikeRoute = lazy(() => import('./spike/SpikeRoute.tsx'))
const CityRoute = lazy(() => import('./city/CityRoute.tsx'))
const AdminRoute = lazy(() => import('./admin/AdminRoute.tsx'))

function App() {
  const path = usePath()
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
  return <Landing />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

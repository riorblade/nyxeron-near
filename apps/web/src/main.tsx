import './index.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Landing } from './landing/Landing.tsx'
import { Practice } from './practice/Practice.tsx'
import { usePath } from './router.tsx'

// Screens that need sign-in load Privy with them; Practice and the landing stay light.
const SpikeRoute = lazy(() => import('./spike/SpikeRoute.tsx'))

function App() {
  const path = usePath()
  if (path.startsWith('/practice')) return <Practice />
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

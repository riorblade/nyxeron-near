import { PrivyProvider } from '@privy-io/react-auth'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivySpike } from './spike/PrivySpike.tsx'

const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined
const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    {appId ? (
      <PrivyProvider
        appId={appId}
        config={{
          loginMethods: ['google', 'email'],
          // Signing must never show a Privy screen: the player taps "buy" and the drink appears.
          embeddedWallets: { showWalletUIs: false },
        }}
      >
        <PrivySpike />
      </PrivyProvider>
    ) : (
      <p>Set VITE_PRIVY_APP_ID in apps/web/.env (see .env.example).</p>
    )}
  </StrictMode>,
)

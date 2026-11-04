import { PrivyProvider } from '@privy-io/react-auth'
import type { ReactNode } from 'react'

const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined

/** Privy sign-in for the screens past Practice. Loaded lazily, so Practice never downloads it. */
export function WithPrivy({ children }: { children: ReactNode }) {
  if (!appId) return <p className="p-6">Set VITE_PRIVY_APP_ID in apps/web/.env (see .env.example).</p>
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['google', 'email'],
        // Signing must never show a Privy screen: the player taps "buy" and the drink appears (spike 10).
        embeddedWallets: { showWalletUIs: false },
      }}
    >
      {children}
    </PrivyProvider>
  )
}

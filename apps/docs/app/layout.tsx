import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import type { ReactNode } from 'react'
import { siteUrl } from '@/lib/shared'
import './global.css'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'NYXERON Docs', template: '%s · NYXERON Docs' },
  description: 'A nightclub game on NEAR where every drink is a real share.',
  openGraph: { images: '/images/cover.jpg' },
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${geist.className}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ forcedTheme: 'dark', defaultTheme: 'dark' }}>{children}</RootProvider>
      </body>
    </html>
  )
}

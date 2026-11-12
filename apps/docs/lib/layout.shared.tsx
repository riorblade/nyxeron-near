import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { appName } from './shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold tracking-[0.2em] uppercase">
          <img src="/logo/mark-white.svg" alt="" width={22} height={22} />
          {appName}
        </span>
      ),
    },
    links: [
      { text: 'Launch app', url: 'https://app.nyxeron.xyz', external: true },
      { text: 'Proof', url: 'https://app.nyxeron.xyz/proof', external: true },
      { text: 'nyxeron.xyz', url: 'https://nyxeron.xyz', external: true },
    ],
  }
}

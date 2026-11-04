import { useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { explorer } from '../near/chain.ts'

/** Who is signed in, their dollars, and the way in and out of the game (Add money / Cash out). */
export function AccountBar({ account }: { account: Account }) {
  const [panel, setPanel] = useState<'add' | 'cashout'>()
  const { profile, balance, config, address } = account
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
      <div>
        <div className="font-semibold">{profile?.name || profile?.email || 'Signing in…'}</div>
        {address && config && (
          <a
            href={`${explorer(config.network)}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted hover:text-ink"
            title={address}
          >
            NEAR account {address.slice(0, 6)}…{address.slice(-4)} ↗
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="mr-2 text-right">
          <div className="text-xs text-muted">Balance</div>
          <div className="text-lg font-bold tabular-nums">{balance === undefined ? '…' : usd(balance)}</div>
        </div>
        <button onClick={() => setPanel('add')} className="rounded-xl bg-gold px-3 py-2 text-sm font-bold text-night">
          Add money
        </button>
        <button onClick={() => setPanel('cashout')} className="rounded-xl border border-line px-3 py-2 text-sm">
          Cash out
        </button>
        <button onClick={account.logout} className="ml-1 text-xs text-muted hover:text-ink">
          Sign out
        </button>
      </div>
      {panel && <MoneyPanel kind={panel} onClose={() => setPanel(undefined)} />}
    </div>
  )
}

// Add money and Cash out go through NEAR Intents 1Click (any chain in, any chain out). The screens are here; the api
// endpoints arrive with services/api intents.ts, so for now they explain what will happen.
function MoneyPanel({ kind, onClose }: { kind: 'add' | 'cashout'; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-night/80 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-label={kind === 'add' ? 'Add money' : 'Cash out'}
        className="w-full max-w-md rounded-2xl border border-line bg-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold">{kind === 'add' ? 'Add money' : 'Cash out'}</h2>
        <p className="mt-2 text-sm text-muted">
          {kind === 'add'
            ? 'Send dollars (USDC) from any chain or exchange; they land in your own account here, usually in under a minute.'
            : 'Send your dollars to any chain or exchange. You sign it here, we pay the fees.'}
        </p>
        <p className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
          Not open yet: this is coming in the next update.
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl border border-line py-2 text-sm hover:border-violet"
        >
          Close
        </button>
      </section>
    </div>
  )
}

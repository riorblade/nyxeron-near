import { useState } from 'react'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { explorer } from '../near/chain.ts'
import { playerMessage } from './errors.ts'
import { MoneyPanel } from './MoneyPanel.tsx'

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
        {config?.testDollars && <TestDollars account={account} />}
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
      {panel && <MoneyPanel account={account} kind={panel} onClose={() => setPanel(undefined)} />}
    </div>
  )
}

// Testnet only (DEMO_MODE): a few real Circle testnet dollars from our faucet, once a day, so a judge can buy drinks.
function TestDollars({ account }: { account: Account }) {
  const [state, setState] = useState<{ busy?: boolean; note?: string; ok?: boolean }>({})
  const grant = account.config!.testDollars!
  const empty = grant.faucetBalance !== null && grant.faucetBalance < grant.amount

  const get = async () => {
    setState({ busy: true })
    const r = await account.api.me['test-dollars'].$post()
    if (r.ok) {
      setState({ ok: true, note: `${usd(grant.amount)} on the way.` })
      // The transfer is final when the api answers; read the balance now and once more in case the RPC lags.
      void account.refreshBalance()
      setTimeout(() => void account.refreshBalance(), 3000)
    } else {
      const code = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'unknown'
      setState({ note: code === 'too_soon' ? "You already got today's test dollars." : playerMessage(code) })
    }
    void account.reloadConfig()
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={() => void get()}
        disabled={state.busy || empty || !account.canPay}
        title={empty ? 'The test faucet is empty right now.' : `Free test dollars (${usd(grant.amount)}), once a day`}
        className="rounded-xl border border-neon/60 px-3 py-2 text-sm text-neon disabled:opacity-40"
      >
        {state.busy ? 'Sending…' : 'Get test dollars'}
      </button>
      {(state.note || empty) && (
        <span className={`mt-1 text-xs ${state.ok ? 'text-up' : 'text-muted'}`}>
          {state.note ?? 'The test faucet is empty right now.'}
        </span>
      )}
    </div>
  )
}

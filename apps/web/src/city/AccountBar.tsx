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
  const who = profile?.name || profile?.email
  return (
    <div className="cy-hud">
      <div className="cy-who">
        <span className="cy-face" aria-hidden>
          {(who ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="cy-player" title={who}>
            {who || 'Signing in…'}
          </div>
          {address && config && (
            <a
              href={`${explorer(config.network)}/address/${address}`}
              target="_blank"
              rel="noreferrer"
              className="cy-addr"
              title={address}
            >
              NEAR {address.slice(0, 6)}…{address.slice(-4)} ↗
            </a>
          )}
        </div>
      </div>
      <div className="cy-purse">
        <span className="cy-purse-label">Balance</span>
        <span className="cy-purse-value">{balance === undefined ? '…' : usd(balance)}</span>
      </div>
      <div className="cy-moves">
        {config?.testDollars && <TestDollars account={account} />}
        <button onClick={() => setPanel('add')} className="cy-btn cy-btn-gold">
          Add money
        </button>
        <button onClick={() => setPanel('cashout')} className="cy-btn">
          Cash out
        </button>
        <button onClick={account.logout} className="cy-signout">
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
    <div className="cy-faucet">
      <button
        onClick={() => void get()}
        disabled={state.busy || empty || !account.canPay}
        title={empty ? 'The test faucet is empty right now.' : `Free test dollars (${usd(grant.amount)}), once a day`}
        className="cy-btn cy-btn-neon"
      >
        {state.busy ? 'Sending…' : 'Get test dollars'}
        <span className="cy-btn-sub">+{usd(grant.amount)} daily</span>
      </button>
      {(state.note || empty) && (
        <span className={`cy-faucet-note${state.ok ? ' is-ok' : ''}`}>
          {state.note ?? 'The test faucet is empty right now.'}
        </span>
      )}
    </div>
  )
}

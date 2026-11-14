// Add money and Cash out, through NEAR Intents 1Click (money.ts). Pick a coin and chain, get a live quote, then on
// mainnet send to the deposit address (Add money) or sign the transfer here (Cash out) and watch its status.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Account } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { nearProvider } from '../near/chain.ts'
import type { Call } from '../near/delegate.ts'
import { PlayerError, playerMessage } from './errors.ts'
import { addressHint, cashOutProblem, type Coin, coinLabel, COINS, intentStatus, payCashOut } from './money.ts'

type Quote = {
  dry: boolean
  amountInFormatted?: string
  amountOutFormatted?: string
  timeEstimate?: number
  intent?: { id: string; depositAddress: string; depositMemo?: string; deadline: number }
  payment?: Call
}

export function MoneyPanel({
  account,
  kind,
  onClose,
}: {
  account: Account
  kind: 'add' | 'cashout'
  onClose: () => void
}) {
  // Escape closes it, like any game window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])
  // On the body: the account bar's blur would otherwise trap a fixed window inside it.
  return createPortal(
    <div className="cy-modal" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'add' ? 'Add money' : 'Cash out'}
        className="cy-window"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cy-window-top">
          <span className="cy-tag">{kind === 'add' ? 'Money in' : 'Money out'}</span>
          <h2 className="cy-window-title">{kind === 'add' ? 'Add money' : 'Cash out'}</h2>
          <button onClick={onClose} className="cy-x" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="cy-window-body">
          {account.balance !== undefined && (
            <p className="cy-window-purse">
              <span>Balance</span> <b>{usd(account.balance)}</b>
            </p>
          )}
          <p className="cy-window-text">
            {kind === 'add'
              ? 'Send crypto from any chain or exchange; it arrives as dollars (USDC) in your own account here.'
              : 'Send your dollars to any chain or exchange. You sign it here, we pay the fees.'}
          </p>
          {kind === 'add' ? <AddMoney account={account} /> : <CashOut account={account} />}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function CoinPicker({ coin, onChange }: { coin: Coin; onChange: (c: Coin) => void }) {
  return (
    <label className="cy-field mt-4">
      Coin and chain
      <select
        value={COINS.indexOf(coin)}
        onChange={(e) => onChange(COINS[Number(e.target.value)]!)}
        className="cy-input"
      >
        {COINS.map((c, i) => (
          <option key={i} value={i}>
            {coinLabel(c)}
          </option>
        ))}
      </select>
    </label>
  )
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="cy-field mt-3">
      {props.label}
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        spellCheck={false}
        className="cy-input font-mono"
      />
    </label>
  )
}

async function errorOf(r: Response): Promise<string> {
  const code = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'unknown'
  return playerMessage(code)
}

const DryRun = () => (
  <p className="cy-note">
    Test network: this is a live quote from NEAR Intents, but nothing is sent. Real transfers open on mainnet.
  </p>
)

function AddMoney({ account }: { account: Account }) {
  const [coin, setCoin] = useState<Coin>(COINS[0])
  const [amount, setAmount] = useState('10')
  const [refundTo, setRefundTo] = useState('')
  const [quote, setQuote] = useState<Quote>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const ask = async () => {
    setBusy(true)
    setError(undefined)
    setQuote(undefined)
    try {
      const r = await account.api.me['add-money'].$post({
        json: {
          from: { blockchain: coin.blockchain, symbol: coin.symbol },
          amount: amount.trim(),
          refundTo: refundTo.trim(),
        },
      })
      if (!r.ok) return setError(await errorOf(r))
      setQuote((await r.json()) as Quote)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <CoinPicker coin={coin} onChange={(c) => (setCoin(c), setQuote(undefined))} />
      <Field label={`Amount in ${coin.symbol}`} value={amount} onChange={setAmount} placeholder="10" />
      <Field
        label="Your address there, for a refund if the transfer can't complete"
        value={refundTo}
        onChange={setRefundTo}
        placeholder={addressHint(coin)}
      />
      <button
        onClick={() => void ask()}
        disabled={busy || !amount.trim() || refundTo.trim().length < 2}
        className="cy-btn cy-btn-gold cy-btn-wide mt-5"
      >
        {busy ? 'Getting a quote…' : 'Get a quote'}
      </button>
      {error && <p className="mt-3 text-sm text-down">{error}</p>}
      {quote && (
        <div className="cy-quote">
          <p>
            You send <b>{quote.amountInFormatted ?? amount}</b> {coinLabel(coin)}. You get about{' '}
            <b>${quote.amountOutFormatted}</b> here
            {quote.timeEstimate ? `, in about ${quote.timeEstimate} s` : ''}.
          </p>
          {quote.dry ? (
            <DryRun />
          ) : (
            quote.intent && (
              <Deposit account={account} intent={quote.intent} send={`${quote.amountInFormatted} ${coinLabel(coin)}`} />
            )
          )}
        </div>
      )}
    </div>
  )
}

function Deposit({ account, intent, send }: { account: Account; intent: NonNullable<Quote['intent']>; send: string }) {
  return (
    <div className="cy-deposit">
      <p className="text-xs text-muted">
        Send exactly {send} to this address before{' '}
        {new Date(intent.deadline).toLocaleTimeString([], { timeStyle: 'short' })}:
      </p>
      <p className="mt-1 font-mono text-xs break-all select-all">{intent.depositAddress}</p>
      {intent.depositMemo && (
        <p className="mt-1 text-xs">
          Memo (required): <span className="font-mono select-all">{intent.depositMemo}</span>
        </p>
      )}
      <IntentStatus account={account} id={intent.id} />
    </div>
  )
}

// Polls the api (which asks 1Click at most every 10 s) until the transfer is final, then reads the balance again.
function IntentStatus({ account, id }: { account: Account; id: string }) {
  const [status, setStatus] = useState('PENDING_DEPOSIT')
  const { api, refreshBalance } = account
  useEffect(() => {
    let stop = false
    const tick = async () => {
      const r = await api.me.intents[':id'].$get({ param: { id } })
      if (stop || !r.ok) return
      const s = (await r.json()).status
      setStatus(s)
      if (intentStatus(s).final) {
        stop = true
        void refreshBalance()
      }
    }
    void tick()
    const timer = setInterval(() => !stop && void tick(), 10_000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [api, id, refreshBalance])
  const s = intentStatus(status)
  return <p className={`mt-2 text-sm ${s.ok ? 'text-up' : s.final ? 'text-down' : 'text-ink'}`}>{s.text}</p>
}

function CashOut({ account }: { account: Account }) {
  const [coin, setCoin] = useState<Coin>(COINS[0])
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')
  const [quote, setQuote] = useState<Quote>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<'quote' | 'pay'>()
  const [paid, setPaid] = useState<string>()
  const problem = amount ? cashOutProblem(amount, account.balance) : undefined

  const ask = async () => {
    setBusy('quote')
    setError(undefined)
    setQuote(undefined)
    try {
      const r = await account.api.me['cash-out'].$post({
        json: {
          to: { blockchain: coin.blockchain, symbol: coin.symbol, address: address.trim() },
          amount: amount.trim(),
        },
      })
      if (!r.ok) return setError(await errorOf(r))
      setQuote((await r.json()) as Quote)
    } finally {
      setBusy(undefined)
    }
  }

  const pay = async () => {
    if (!quote?.payment || !quote.intent || !account.config || !account.address || !account.sign) return
    setBusy('pay')
    setError(undefined)
    try {
      await payCashOut(
        {
          api: { relay: (body) => account.api.relay.$post({ json: body }) as Promise<Response> },
          provider: nearProvider(account.config.network),
          sender: account.address,
          sign: account.sign,
        },
        quote.payment,
      )
      setPaid(quote.intent.id)
      void account.refreshBalance()
    } catch (e) {
      setError(e instanceof PlayerError ? e.message : playerMessage('unknown'))
    } finally {
      setBusy(undefined)
    }
  }

  if (paid)
    return (
      <div className="cy-quote">
        <p>Sent. Your {coinLabel(coin)} is on its way.</p>
        <IntentStatus account={account} id={paid} />
      </div>
    )
  return (
    <div>
      <CoinPicker coin={coin} onChange={(c) => (setCoin(c), setQuote(undefined))} />
      <Field label="Their address" value={address} onChange={setAddress} placeholder={addressHint(coin)} />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Amount in dollars" value={amount} onChange={setAmount} placeholder="5" />
        </div>
        {account.balance !== undefined && account.balance >= 1_000_000 && (
          <button
            onClick={() => setAmount(String(Math.min(account.balance!, 1_000_000_000) / 1_000_000))}
            className="cy-btn cy-btn-small"
          >
            Max {usd(Math.min(account.balance, 1_000_000_000))}
          </button>
        )}
      </div>
      {problem && <p className="mt-1 text-xs text-down">{problem}</p>}
      {!quote ? (
        <button
          onClick={() => void ask()}
          disabled={busy !== undefined || !amount || problem !== undefined || address.trim().length < 2}
          className="cy-btn cy-btn-gold cy-btn-wide mt-5"
        >
          {busy === 'quote' ? 'Getting a quote…' : 'Get a quote'}
        </button>
      ) : (
        <div className="cy-quote">
          <p>
            You send <b>${quote.amountInFormatted ?? amount}</b>. They get about <b>{quote.amountOutFormatted}</b>{' '}
            {coinLabel(coin)}
            {quote.timeEstimate ? `, in about ${quote.timeEstimate} s` : ''}.
          </p>
          {quote.dry ? (
            <DryRun />
          ) : (
            <button
              onClick={() => void pay()}
              disabled={busy !== undefined || !account.canPay}
              className="cy-btn cy-btn-gold cy-btn-wide mt-3"
            >
              {busy === 'pay' ? 'Sending…' : 'Confirm cash out'}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-down">{error}</p>}
    </div>
  )
}

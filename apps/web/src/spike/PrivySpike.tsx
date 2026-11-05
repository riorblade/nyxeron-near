// Spike 10 (#29): does the Privy NEAR wallet sign with no UI? Sign in, create the wallet, onboard, then sign a drink
// payment delegate and relay it, while watching the page for anything Privy shows. Results go to spikes/FINDINGS.md.
import { useMfaEnrollment, usePrivy } from '@privy-io/react-auth'
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains'
import { JsonRpcProvider } from 'near-api-js'
import { useEffect, useState } from 'react'
import { paymentDelegate, signDelegate, type SignHash } from '../near/delegate.ts'

type ApiConfig = { network: 'testnet' | 'mainnet'; contractId: string; usdcId: string }

const RPC = { testnet: 'https://test.rpc.fastnear.com', mainnet: 'https://free.rpc.fastnear.com' }

// Anything Privy adds to the page while we sign (a modal, a dialog, an MFA screen) counts as UI.
function watchForUi(): () => string[] {
  const seen: string[] = []
  const observer = new MutationObserver((records) => {
    for (const r of records)
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        const label = `${node.tagName.toLowerCase()}#${node.id}.${node.className}`.slice(0, 120)
        if (/privy|modal|dialog/i.test(label) || node.querySelector('[role="dialog"]')) seen.push(label)
      }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    return seen
  }
}

export function PrivySpike() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { createWallet } = useCreateWallet()
  const { signRawHash } = useSignRawHash()
  const { showMfaEnrollmentModal } = useMfaEnrollment()
  const [config, setConfig] = useState<ApiConfig>()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const wallet = user?.linkedAccounts.find((a) => a.type === 'wallet' && a.chainType === 'near')
  const address = wallet?.type === 'wallet' ? wallet.address : undefined

  const write = (line: string) => {
    const entry = `${new Date().toISOString().slice(11, 23)} ${navigator.userAgent.includes('iPhone') ? 'iphone' : 'desktop'} ${line}`
    setLog((l) => [...l, entry])
    // Dev only: the vite server appends it to apps/web/.data/spike10.log, so results come off the phone without screenshots.
    if (import.meta.env.DEV) void fetch('/__spike-log', { method: 'POST', body: entry }).catch(() => undefined)
  }

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json() as Promise<ApiConfig>)
      .then(setConfig)
      .catch((e: unknown) => write(`GET /api/config failed: ${String(e)}`))
  }, [])

  async function api(method: string, path: string, body?: unknown) {
    const token = await getAccessToken()
    const res = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    write(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`)
    return res
  }

  async function step(name: string, fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      write(`${name} failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const sign: SignHash = async (hash) => {
    const stop = watchForUi()
    const t0 = performance.now()
    try {
      const { signature } = await signRawHash({ address: address!, chainType: 'near', hash })
      const ui = stop()
      write(
        `signRawHash ${Math.round(performance.now() - t0)} ms · hash ${hash} → signature ${signature} ` +
          `(${(signature.length - 2) / 2} bytes) · UI seen: ${ui.length ? ui.join(', ') : 'none'}`,
      )
      return signature
    } catch (e) {
      stop()
      throw e
    }
  }

  async function buildPayment() {
    if (!config || !address) throw new Error('need /api/config and a NEAR wallet')
    return paymentDelegate(new JsonRpcProvider({ url: RPC[config.network] }), {
      sender: address,
      usdc: config.usdcId,
      contract: config.contractId,
      amount: '410000',
      msg: '{}',
    })
  }

  if (!ready) return <p>Loading Privy…</p>

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
      <h1>Spike 10 · Privy NEAR wallet</h1>
      <p>
        Network {config?.network ?? '?'} · contract {config?.contractId ?? '?'} · USDC {config?.usdcId ?? '?'}
      </p>
      <p>
        User {user?.id ?? '—'} · NEAR wallet <code>{address ?? '—'}</code>
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {!authenticated && <button onClick={login}>Sign in</button>}
        {authenticated && !address && (
          <button
            disabled={busy}
            onClick={() =>
              step('createWallet', async () => {
                const t0 = performance.now()
                const { wallet: w } = await createWallet({ chainType: 'near' })
                write(`createWallet ${Math.round(performance.now() - t0)} ms → ${JSON.stringify(w)}`)
              })
            }
          >
            Create NEAR wallet
          </button>
        )}
        {authenticated && (
          <>
            <button disabled={busy} onClick={() => step('me', () => api('GET', '/api/me').then(() => undefined))}>
              GET /api/me
            </button>
            <button
              disabled={busy || !address}
              onClick={() => step('onboard', () => api('POST', '/api/onboard').then(() => undefined))}
            >
              Onboard
            </button>
            <button
              disabled={busy || !address}
              onClick={() =>
                step('relay', async () => {
                  const signedDelegate = await signDelegate(await buildPayment(), sign)
                  await api('POST', '/api/relay', { signedDelegate })
                })
              }
            >
              Sign + relay payment
            </button>
            <button
              disabled={busy || !address}
              onClick={() =>
                step('sign ×5', async () => {
                  const delegate = await buildPayment()
                  for (let i = 0; i < 5; i++) await signDelegate(delegate, sign)
                })
              }
            >
              Sign ×5 (timing, not sent)
            </button>
            {/* MFA only applies to players who enrolled; this is how the spike tests signing with MFA on. */}
            <button disabled={busy} onClick={() => step('mfa', showMfaEnrollmentModal)}>
              Enroll MFA
            </button>
            <button disabled={busy} onClick={() => step('logout', logout)}>
              Log out
            </button>
          </>
        )}
      </div>

      {wallet && <pre style={{ whiteSpace: 'pre-wrap' }}>linkedAccount: {JSON.stringify(wallet, null, 2)}</pre>}
      <pre style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#ddd', padding: 12, minHeight: 120 }}>
        {log.join('\n')}
      </pre>
    </main>
  )
}

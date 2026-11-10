// Back office, lazy-loaded. The UI only hides what a role can't use; the api repeats every check.
import type { InferResponseType } from 'hono/client'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from '../auth/useAccount.ts'
import { usd } from '../format.ts'
import { Link } from '../router.tsx'

// Play credits are counted in cents (services/api players.ts: 10 000 = $100).
const CENT_IN_MICRO = 10_000

type Users = InferResponseType<ReturnType<typeof useAccount>['api']['admin']['users']['$get'], 200>['users']

export default function Admin() {
  const account = useAccount()
  const [role, setRole] = useState<string | null>()
  const [users, setUsers] = useState<Users>()
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!account.authenticated) return
    void (async () => {
      const r = await account.api.admin.me.$get()
      setRole(r.ok ? (await r.json()).role : null)
    })()
  }, [account.authenticated, account.api])

  useEffect(() => {
    if (!role) return
    const id = setTimeout(async () => {
      const r = await account.api.admin.users.$get({ query: { q, limit: '50' } })
      if (r.ok) setUsers((await r.json()).users)
    }, 250)
    return () => clearTimeout(id)
  }, [role, q, account.api])

  if (!account.ready) return <p className="p-6 text-muted">Loading…</p>
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/" className="text-xs text-muted hover:text-ink">
        ← NYXERON
      </Link>
      <h1 className="text-2xl font-bold">Back office</h1>
      {!account.authenticated ? (
        <button onClick={() => account.login()} className="mt-4 rounded-xl bg-gold px-4 py-2 font-bold text-night">
          Sign in
        </button>
      ) : role === null ? (
        <p className="mt-4 text-down">This account has no back-office access.</p>
      ) : role === undefined ? (
        <p className="mt-4 text-muted">Checking access…</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Signed in as {account.profile?.email} · {role}
          </p>
          <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Players</h2>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search email, name or account"
                className="w-72 max-w-full rounded-lg border border-line bg-night px-3 py-1.5 text-sm"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 font-normal">Email</th>
                    <th className="py-1 font-normal">Name</th>
                    <th className="py-1 font-normal">NEAR account</th>
                    <th className="py-1 text-right font-normal">Play credits</th>
                    <th className="py-1 font-normal">Status</th>
                    <th className="py-1 font-normal">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {users?.map((u) => (
                    <tr key={u.id} className="border-t border-line">
                      <td className="py-1">{u.email}</td>
                      <td className="py-1">{u.name}</td>
                      <td className="py-1 font-mono text-xs" title={u.nearAccount}>
                        {u.nearAccount ? `${u.nearAccount.slice(0, 8)}…` : '—'}
                      </td>
                      <td className="py-1 text-right tabular-nums">{usd(u.credits * CENT_IN_MICRO)}</td>
                      <td className="py-1">{u.banned ? <span className="text-down">banned</span> : 'active'}</td>
                      <td className="py-1 text-muted">{new Date(u.lastSeen).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {users?.length === 0 && <p className="mt-2 text-sm text-muted">No players match.</p>}
          </section>
          <SettlementProblems account={account} canRetry={role !== 'viewer'} />
          <p className="mt-3 text-xs text-muted">Sales, stock and audit appear here as the api adds them.</p>
        </>
      )}
    </main>
  )
}

type Failed = InferResponseType<ReturnType<typeof useAccount>['api']['admin']['settlement']['$get'], 200>['failed']

// Settlement steps that stopped after their retries (services/api settlement.ts): the party's guests are waiting on
// these. Retry runs the step again; the contract's ids make a repeat harmless.
function SettlementProblems({ account, canRetry }: { account: ReturnType<typeof useAccount>; canRetry: boolean }) {
  const [failed, setFailed] = useState<Failed>()
  const [note, setNote] = useState<string>()

  const load = useCallback(async () => {
    const r = await account.api.admin.settlement.$get()
    if (r.ok) setFailed((await r.json()).failed)
  }, [account.api])

  useEffect(() => {
    void load()
  }, [load])

  const retry = async (op: string) => {
    const r = await account.api.admin.settlement[':op'].retry.$post({ param: { op } })
    setNote(r.ok ? `Retrying ${op}.` : `Couldn't retry ${op}.`)
    void load()
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Settlement problems</h2>
      {failed?.length === 0 && <p className="text-sm text-muted">None. Every party's shares went out.</p>}
      {failed && failed.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-normal">Party</th>
              <th className="py-1 font-normal">Step</th>
              <th className="py-1 font-normal">Tries</th>
              <th className="py-1 font-normal">Error</th>
              <th className="py-1 font-normal">When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {failed.map((f) => (
              <tr key={f.id} className="border-t border-line">
                <td className="py-1">#{f.party}</td>
                <td className="py-1">{f.kind}</td>
                <td className="py-1 tabular-nums">{f.attempts}</td>
                <td className="max-w-64 truncate py-1 text-down" title={f.error}>
                  {f.error}
                </td>
                <td className="py-1 text-muted">{new Date(f.updatedAt).toLocaleString()}</td>
                <td className="py-1 text-right">
                  {canRetry && (
                    <button
                      onClick={() => void retry(f.id)}
                      className="rounded-lg border border-line px-2 py-0.5 text-xs"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </section>
  )
}

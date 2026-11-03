import { describe, expect, it, vi } from 'vitest'
import { one } from './db.ts'
import { DEMO_CREDITS } from './players.ts'
import { fakeIdentity, testApp } from './testing.ts'

describe('GET /api/health', () => {
  it('answers without sign-in', async () => {
    const res = await testApp().call('GET', '/api/health')
    expect(await res.json()).toEqual({ ok: true, network: 'testnet' })
  })
})

describe('sign-in', () => {
  it('refuses no token and a bad token', async () => {
    const { call } = testApp()
    for (const token of [undefined, 'garbage']) {
      const res = await call('GET', '/api/me', token)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    }
  })

  it('creates the player on first sign-in with the NEAR account from Privy', async () => {
    const { call } = testApp()
    const body = (await (await call('GET', '/api/me', 'tok-alice')).json()) as Record<string, unknown>
    expect(body).toMatchObject({ id: 'did:privy:alice', email: 'alice@test.io', credits: 0, banned: false })
    expect(body.nearAccount).toMatch(/^[0-9a-f]{64}$/)
  })

  it('answers 503 when Privy is down for a new player, but lets a known player in', async () => {
    const down = fakeIdentity({ bob: 'down' })
    const { call, db } = testApp({}, down)
    expect((await call('GET', '/api/me', 'tok-bob')).status).toBe(503)
    db.prepare("INSERT INTO users (id, created_at, last_seen) VALUES ('did:privy:bob', 0, 0)").run()
    expect((await call('GET', '/api/me', 'tok-bob')).status).toBe(200)
  })

  it('fills in the NEAR account once Privy has created it (asking at most every 30 s), and never replaces it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const profiles = { carol: { email: 'carol@test.io', nearAccount: '' } }
      const { call, db } = testApp({}, fakeIdentity(profiles))
      const near = () =>
        one<{ near_account: string }>(db, "SELECT near_account FROM users WHERE id = 'did:privy:carol'")!.near_account
      const later = () => vi.setSystemTime(Date.now() + 31_000)

      await call('GET', '/api/me', 'tok-carol')
      expect(near()).toBe('')
      profiles.carol.nearAccount = 'c'.repeat(64)
      await call('GET', '/api/me', 'tok-carol')
      expect(near()).toBe('') // asked Privy a moment ago: not again yet
      later()
      await call('GET', '/api/me', 'tok-carol')
      expect(near()).toBe('c'.repeat(64))
      profiles.carol.nearAccount = 'd'.repeat(64)
      later()
      await call('GET', '/api/me', 'tok-carol')
      expect(near()).toBe('c'.repeat(64))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PATCH /api/me', () => {
  it('renames the player', async () => {
    const { call } = testApp()
    const res = await call('PATCH', '/api/me', 'tok-alice', { name: '  DJ Nyx ' })
    expect(await res.json()).toMatchObject({ name: 'DJ Nyx' })
    expect(await (await call('GET', '/api/me', 'tok-alice')).json()).toMatchObject({ name: 'DJ Nyx' })
  })

  it('refuses a bad name with bad_request', async () => {
    const { call } = testApp()
    for (const name of ['x', 'a'.repeat(25), '<script>']) {
      const res = await call('PATCH', '/api/me', 'tok-alice', { name })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_request' })
    }
  })

  it('lets a banned player read but not write', async () => {
    const { call, ban } = testApp()
    await call('GET', '/api/me', 'tok-alice')
    ban('alice')
    expect((await call('GET', '/api/me', 'tok-alice')).status).toBe(200)
    const res = await call('PATCH', '/api/me', 'tok-alice', { name: 'New Name' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'banned' })
  })
})

describe('POST /api/me/demo-credits', () => {
  it('does not exist unless DEMO_MODE is on', async () => {
    const res = await testApp().call('POST', '/api/me/demo-credits', 'tok-alice')
    expect(res.status).toBe(404)
  })

  it('grants demo credits once a day, with a ledger row', async () => {
    const { call } = testApp({ DEMO_MODE: 'true' })
    const first = await call('POST', '/api/me/demo-credits', 'tok-alice')
    expect(await first.json()).toEqual({ credits: DEMO_CREDITS })
    const again = await call('POST', '/api/me/demo-credits', 'tok-alice')
    expect(again.status).toBe(429)
    expect(await again.json()).toEqual({ error: 'too_soon' })
    const ledger = (await (await call('GET', '/api/me/ledger', 'tok-alice')).json()) as { entries: unknown[] }
    expect(ledger.entries).toEqual([
      expect.objectContaining({ delta: DEMO_CREDITS, balance: DEMO_CREDITS, kind: 'demo' }),
    ])
  })

  it('gives nothing to a banned player', async () => {
    const { call, ban } = testApp({ DEMO_MODE: 'true' })
    await call('GET', '/api/me', 'tok-alice')
    ban('alice')
    expect((await call('POST', '/api/me/demo-credits', 'tok-alice')).status).toBe(403)
  })
})

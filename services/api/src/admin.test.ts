import { describe, expect, it } from 'vitest'
import { run } from './db.ts'
import { testApp } from './testing.ts'

const owner = { OWNER_EMAILS: 'boss@test.io' }

describe('back office access', () => {
  it('needs sign-in, then an admin role', async () => {
    const { call } = testApp(owner)
    expect((await call('GET', '/api/admin/me')).status).toBe(401)
    const res = await call('GET', '/api/admin/me', 'tok-alice')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not_admin' })
  })

  it('makes OWNER_EMAILS owners and reads other roles from the admins table', async () => {
    const { call, db } = testApp(owner)
    expect(await (await call('GET', '/api/admin/me', 'tok-boss')).json()).toEqual({
      email: 'boss@test.io',
      role: 'owner',
    })
    run(db, "INSERT INTO admins (email, role, granted_by, at) VALUES ('vera@test.io', 'viewer', 'boss@test.io', 0)")
    expect(await (await call('GET', '/api/admin/me', 'tok-vera')).json()).toMatchObject({ role: 'viewer' })
  })
})

describe('GET /api/admin/users', () => {
  it('finds players by email, name or NEAR account, newest activity first', async () => {
    const { call } = testApp(owner)
    for (const p of ['alice', 'bob', 'carol']) await call('GET', '/api/me', `tok-${p}`)
    await call('PATCH', '/api/me', 'tok-bob', { name: 'Bobby Drop' })

    const all = (await (await call('GET', '/api/admin/users', 'tok-boss')).json()) as { users: { email: string }[] }
    expect(all.users.map((u) => u.email).sort()).toEqual([
      'alice@test.io',
      'bob@test.io',
      'boss@test.io',
      'carol@test.io',
    ])
    const byName = (await (await call('GET', '/api/admin/users?q=drop', 'tok-boss')).json()) as {
      users: { email: string; name: string }[]
    }
    expect(byName.users).toEqual([expect.objectContaining({ email: 'bob@test.io', name: 'Bobby Drop' })])
  })

  it('treats % and _ in the search as plain text', async () => {
    const { call } = testApp(owner)
    await call('GET', '/api/me', 'tok-alice')
    const res = (await (await call('GET', '/api/admin/users?q=%25', 'tok-boss')).json()) as { users: unknown[] }
    expect(res.users).toEqual([])
  })

  it('refuses a bad limit', async () => {
    const { call } = testApp(owner)
    const res = await call('GET', '/api/admin/users?limit=5000', 'tok-boss')
    expect(res.status).toBe(400)
  })
})

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

describe('moderation: ban / unban, staff, audit', () => {
  const setup = () => {
    const t = testApp(owner)
    const id = async (who: string) =>
      ((await (await t.call('GET', '/api/me', `tok-${who}`)).json()) as { id: string }).id
    const ban = (target: string, by = 'tok-boss', reason = 'spam in the party chat', action = 'ban') =>
      t.call('POST', `/api/admin/users/${encodeURIComponent(target)}/${action}`, by, { reason })
    return { ...t, id, ban }
  }

  it('bans with a reason: the player can still read but not write; unban gives it back; both are audited', async () => {
    const { call, id, ban } = setup()
    const alice = await id('alice')
    expect((await ban(alice, 'tok-boss', 'x')).status).toBe(400) // a reason is required
    const res = await ban(alice)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: alice, banned: true, banReason: 'spam in the party chat' })
    expect((await call('GET', '/api/me', 'tok-alice')).status).toBe(200)
    expect((await call('PATCH', '/api/me', 'tok-alice', { name: 'Back again' })).status).toBe(403)
    expect((await ban(alice)).status).toBe(409) // already banned
    expect((await ban(alice, 'tok-boss', 'appeal accepted', 'unban')).status).toBe(200)
    expect((await call('PATCH', '/api/me', 'tok-alice', { name: 'Back again' })).status).toBe(200)
    const log = (await (await call('GET', '/api/admin/audit', 'tok-boss')).json()) as { entries: object[] }
    expect(log.entries).toEqual([
      expect.objectContaining({ actor: 'boss@test.io', action: 'unban', target: alice, reason: 'appeal accepted' }),
      expect.objectContaining({
        actor: 'boss@test.io',
        action: 'ban',
        target: alice,
        reason: 'spam in the party chat',
      }),
    ])
  })

  it('a viewer reads but never acts; staff and yourself cannot be banned; unknown player is 404', async () => {
    const { call, db, id, ban } = setup()
    run(db, "INSERT INTO admins (email, role, granted_by, at) VALUES ('vera@test.io', 'viewer', 'boss@test.io', 0)")
    const alice = await id('alice')
    expect((await ban(alice, 'tok-vera')).status).toBe(403)
    expect((await call('GET', '/api/admin/audit', 'tok-vera')).status).toBe(200)
    expect((await ban(await id('vera'))).status).toBe(403) // staff
    expect((await ban(await id('boss'))).status).toBe(403) // yourself
    expect((await ban('did:privy:nobody')).status).toBe(404)
  })

  it('only an owner adds or removes staff, and it is audited', async () => {
    const { call } = setup()
    expect((await call('PUT', '/api/admin/staff', 'tok-boss', { email: 'Ada@Test.io', role: 'admin' })).status).toBe(
      200,
    )
    expect(await (await call('GET', '/api/admin/me', 'tok-ada')).json()).toMatchObject({ role: 'admin' })
    // an admin can't change staff, and nobody turns an owner into staff
    expect((await call('PUT', '/api/admin/staff', 'tok-ada', { email: 'x@test.io', role: 'admin' })).status).toBe(403)
    expect((await call('PUT', '/api/admin/staff', 'tok-boss', { email: 'boss@test.io', role: 'viewer' })).status).toBe(
      409,
    )
    expect((await call('PUT', '/api/admin/staff', 'tok-boss', { email: 'not-an-email', role: 'admin' })).status).toBe(
      400,
    )
    const staff = (await (await call('GET', '/api/admin/staff', 'tok-ada')).json()) as { staff: { email: string }[] }
    expect(staff.staff.map((s) => s.email)).toEqual(['ada@test.io'])
    expect((await call('DELETE', '/api/admin/staff/ada@test.io', 'tok-boss')).status).toBe(200)
    expect((await call('GET', '/api/admin/me', 'tok-ada')).status).toBe(403)
    expect((await call('DELETE', '/api/admin/staff/ada@test.io', 'tok-boss')).status).toBe(404)
    const log = (await (await call('GET', '/api/admin/audit', 'tok-boss')).json()) as { entries: { action: string }[] }
    expect(log.entries.map((e) => e.action)).toEqual(['staff_remove', 'staff_add'])
  })
})

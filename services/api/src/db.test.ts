import { describe, expect, it } from 'vitest'
import { migrate, one, openDb, run, tx } from './db.ts'

const fresh = () => openDb(':memory:')

describe('migrations', () => {
  it('bring a new database to the latest version, and running again changes nothing', () => {
    const db = fresh()
    const v = one<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version
    expect(v).toBeGreaterThan(0)
    migrate(db)
    expect(one<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version).toBe(v)
  })

  it('refuse negative credits at the database level too', () => {
    const db = fresh()
    expect(() => run(db, "INSERT INTO users (id, credits, created_at, last_seen) VALUES ('u', -1, 0, 0)")).toThrow(
      /CHECK/,
    )
  })
})

describe('tx', () => {
  const addUser = (db: ReturnType<typeof fresh>, id: string) =>
    run(db, 'INSERT INTO users (id, created_at, last_seen) VALUES (?, 0, 0)', id)
  const count = (db: ReturnType<typeof fresh>) => one<{ n: number }>(db, 'SELECT count(*) AS n FROM users')!.n

  it('commits what the body did', () => {
    const db = fresh()
    tx(db, () => addUser(db, 'a'))
    expect(count(db)).toBe(1)
  })

  it('rolls everything back when the body throws', () => {
    const db = fresh()
    expect(() =>
      tx(db, () => {
        addUser(db, 'a')
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(count(db)).toBe(0)
    expect(db.isTransaction).toBe(false)
  })

  it('joins an outer transaction, so an inner throw undoes the outer work too', () => {
    const db = fresh()
    expect(() =>
      tx(db, () => {
        addUser(db, 'a')
        tx(db, () => {
          addUser(db, 'b')
          throw new Error('inner')
        })
      }),
    ).toThrow('inner')
    expect(count(db)).toBe(0)
  })

  it('refuses an async body and rolls back', () => {
    const db = fresh()
    expect(() =>
      tx(db, async () => {
        addUser(db, 'a')
      }),
    ).toThrow(/synchronous/)
    expect(count(db)).toBe(0)
  })
})

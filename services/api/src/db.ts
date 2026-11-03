import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export type Db = DatabaseSync

// Append-only: never edit a released migration, add a new one at the end. PRAGMA user_version records how far a
// database has come, so a live database upgrades in place. Money columns are integers (credits, units).
const migrations = [
  // 1. players, their credit history, back-office roles
  `CREATE TABLE users (
     id           TEXT PRIMARY KEY,                -- Privy user id (did:privy:…)
     email        TEXT    NOT NULL DEFAULT '',
     near_account TEXT    NOT NULL DEFAULT '',     -- from Privy, never from the browser
     name         TEXT    NOT NULL DEFAULT '',
     credits      INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
     banned       INTEGER NOT NULL DEFAULT 0,
     ban_reason   TEXT    NOT NULL DEFAULT '',
     created_at   INTEGER NOT NULL,
     last_seen    INTEGER NOT NULL
   );
   CREATE INDEX users_email ON users(email);
   CREATE UNIQUE INDEX users_near ON users(near_account) WHERE near_account <> '';

   CREATE TABLE ledger (
     id      INTEGER PRIMARY KEY,
     user_id TEXT    NOT NULL REFERENCES users(id),
     delta   INTEGER NOT NULL,
     balance INTEGER NOT NULL,                     -- credits after this row
     kind    TEXT    NOT NULL,
     ref     TEXT    NOT NULL DEFAULT '',          -- what caused it: top-up id, sale id, …
     at      INTEGER NOT NULL
   );
   CREATE INDEX ledger_user ON ledger(user_id, id);

   CREATE TABLE admins (
     email      TEXT PRIMARY KEY,
     role       TEXT    NOT NULL CHECK (role IN ('admin', 'viewer')),
     granted_by TEXT    NOT NULL,
     at         INTEGER NOT NULL
   );`,
]

export function openDb(path: string): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const from = one<{ user_version: number }>(db, 'PRAGMA user_version')?.user_version ?? 0
  for (let v = from; v < migrations.length; v++) {
    tx(db, () => {
      db.exec(migrations[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

// Runs fn in one transaction; a throw rolls everything back. A tx inside a tx joins the outer one.
// ponytail: the body must be synchronous (node:sqlite is), so nothing else on the event loop can interleave with it.
export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    if (out instanceof Promise) throw new Error('tx body must be synchronous')
    db.exec('COMMIT')
    return out
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw err
  }
}

export function one<T>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export function all<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]): void {
  db.prepare(sql).run(...params)
}

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
  // 2. every delegate the relayer submitted for a player, for the back office
  `CREATE TABLE relays (
     id       INTEGER PRIMARY KEY,
     user_id  TEXT    NOT NULL REFERENCES users(id),
     receiver TEXT    NOT NULL,
     method   TEXT    NOT NULL,
     tx_hash  TEXT    NOT NULL DEFAULT '',
     ok       INTEGER NOT NULL,
     error    TEXT    NOT NULL DEFAULT '',
     at       INTEGER NOT NULL
   );
   CREATE INDEX relays_user ON relays(user_id, id);`,
  // 3. parties, the host's menu prices, and every drink quote the api signed
  `CREATE TABLE parties (
     id         INTEGER PRIMARY KEY,
     host_id    TEXT    NOT NULL REFERENCES users(id),
     title      TEXT    NOT NULL,
     seed       INTEGER NOT NULL,                -- the game simulation's seed for this night
     starts_at  INTEGER NOT NULL,
     ends_at    INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX parties_ends ON parties(ends_at);
   CREATE TABLE party_prices (
     party_id INTEGER NOT NULL REFERENCES parties(id),
     token    TEXT    NOT NULL,
     price    INTEGER NOT NULL CHECK (price > 0),   -- micro-USDC per unit
     PRIMARY KEY (party_id, token)
   );
   CREATE TABLE quotes (
     id             TEXT    PRIMARY KEY,
     party_id       INTEGER NOT NULL REFERENCES parties(id),
     buyer_id       TEXT    NOT NULL REFERENCES users(id),
     buyer          TEXT    NOT NULL,             -- NEAR account
     ceo            TEXT    NOT NULL,             -- NEAR account
     token          TEXT    NOT NULL,
     qty            INTEGER NOT NULL,
     unit_price     INTEGER NOT NULL,
     unit_wholesale INTEGER NOT NULL,
     expires_ms     INTEGER NOT NULL,
     created_at     INTEGER NOT NULL
   );
   CREATE INDEX quotes_party ON quotes(party_id);`,
  // 4. "Get test dollars" grants on testnet: real Circle testnet USDC sent by the relayer, so not play credits.
  // A row is written before the transfer is sent, so two requests at once can't both pass the once-a-day check.
  `CREATE TABLE test_dollars (
     id       INTEGER PRIMARY KEY,
     user_id  TEXT    NOT NULL REFERENCES users(id),
     account  TEXT    NOT NULL,                    -- NEAR account the dollars went to
     amount   INTEGER NOT NULL CHECK (amount > 0), -- micro-USDC
     status   TEXT    NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
     tx_hash  TEXT    NOT NULL DEFAULT '',
     error    TEXT    NOT NULL DEFAULT '',
     at       INTEGER NOT NULL
   );
   CREATE INDEX test_dollars_user ON test_dollars(user_id, at);`,
  // 5. settlement at party end: one row per party, and the outbox of its on-chain steps (settlement.ts)
  `CREATE TABLE settlements (
     party_id   INTEGER PRIMARY KEY REFERENCES parties(id),
     status     TEXT    NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
     error      TEXT    NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE chain_ops (
     id         TEXT    PRIMARY KEY,               -- release:<party>, mint:<party>:<token>, party:<party>:<batch>
     party_id   INTEGER NOT NULL REFERENCES parties(id),
     seq        INTEGER NOT NULL,                  -- order within the party
     kind       TEXT    NOT NULL CHECK (kind IN ('release', 'mint', 'settle')),
     payload    TEXT    NOT NULL,                  -- JSON: token + units (+ proof) for a mint, transfers for a settle
     status     TEXT    NOT NULL CHECK (status IN ('pending', 'sent', 'done', 'failed')),
     attempts   INTEGER NOT NULL DEFAULT 0,
     next_at    INTEGER NOT NULL,
     tx_hash    TEXT    NOT NULL DEFAULT '',
     error      TEXT    NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL,
     UNIQUE (party_id, seq)
   );
   CREATE INDEX chain_ops_status ON chain_ops(status);`,
  // 6. this database's own id. The contract sees party `<install>-<id>`, so a fresh database (a redeploy) never reuses
  // a party, a settle op id or a demo proof the contract already has.
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   INSERT INTO meta (key, value) VALUES ('install', lower(hex(randomblob(4))));`,
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

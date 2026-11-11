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
  // 7. Add money / Cash out quotes from 1Click (intents.ts). A cash-out row is what lets the relay send the player's
  // USDC to that deposit address, once (deposit_tx).
  `CREATE TABLE intents (
     id                TEXT    PRIMARY KEY,              -- 1Click correlationId
     user_id           TEXT    NOT NULL REFERENCES users(id),
     kind              TEXT    NOT NULL CHECK (kind IN ('add_money', 'cash_out')),
     origin_asset      TEXT    NOT NULL,
     destination_asset TEXT    NOT NULL,
     amount_in         TEXT    NOT NULL,                 -- smallest unit of the origin asset
     amount_out        TEXT    NOT NULL,
     deposit_address   TEXT    NOT NULL UNIQUE,
     deposit_memo      TEXT    NOT NULL DEFAULT '',
     recipient         TEXT    NOT NULL,
     refund_to         TEXT    NOT NULL,
     deadline          INTEGER NOT NULL,                 -- ms; deposit before it
     status            TEXT    NOT NULL,                 -- 1Click status, PENDING_DEPOSIT … SUCCESS / REFUNDED / FAILED
     deposit_tx        TEXT    NOT NULL DEFAULT '',      -- the cash-out deposit the relay sent
     checked_at        INTEGER NOT NULL,
     created_at        INTEGER NOT NULL
   );
   CREATE INDEX intents_user ON intents(user_id, created_at);`,
  // 8. The CEO's moves at a party (parties.ts): happy hour prices every drink 20 % off until \`until_ms\`.
  `CREATE TABLE party_moves (
     party_id INTEGER NOT NULL REFERENCES parties(id),
     kind     TEXT    NOT NULL CHECK (kind IN ('happyHour', 'anthem', 'mcHype', 'pyro')),
     at_ms    INTEGER NOT NULL,
     until_ms INTEGER NOT NULL
   );
   CREATE INDEX party_moves_party ON party_moves(party_id, at_ms);`,
  // 9. the warehouse's share purchases on Robinhood Chain (swap.ts), one or more swaps of ≤ $50 per party and token.
  // The signed transaction is kept before it is broadcast, so a crash or a retry checks that transaction instead of
  // buying again.
  `CREATE TABLE warehouse_swaps (
     id         TEXT    PRIMARY KEY,              -- <party>:<token>, then <party>:<token>:<n> for the n-th extra swap
     token      TEXT    NOT NULL,
     units      INTEGER NOT NULL,
     usdg_in    INTEGER NOT NULL,                 -- micro-USDG
     need_ui    TEXT    NOT NULL,                 -- shares owed, 18 decimals, as balanceOfUI counts them
     need_raw   TEXT    NOT NULL,                 -- the same in balanceOf units: the swap must Transfer at least this
     nonce      INTEGER NOT NULL,
     raw_tx     TEXT    NOT NULL,
     tx_hash    TEXT    NOT NULL,
     -- building: quoting and signing under a lease, nothing sent yet; stuck: a person looks
     status     TEXT    NOT NULL CHECK (status IN ('building', 'sent', 'done', 'failed', 'stuck')),
     error      TEXT    NOT NULL DEFAULT '',
     attempts   INTEGER NOT NULL DEFAULT 1,
     resumes    INTEGER NOT NULL DEFAULT 0,       -- retries that waited for this transaction's receipt
     lease      TEXT    NOT NULL DEFAULT '',      -- which buy() holds a building row
     at         INTEGER NOT NULL                  -- ms of the latest attempt; the daily cap counts by it
   );
   CREATE INDEX warehouse_swaps_at ON warehouse_swaps(at);`,
  // 9. the treasury's deposits through 1Click that fund the warehouse with USDG and gas (fund.ts). A row is written
  // before the USDC is sent, so a crash or a lost answer is looked at by a person instead of sent again.
  `CREATE TABLE warehouse_funding (
     id              TEXT    PRIMARY KEY,              -- 1Click correlationId
     asset           TEXT    NOT NULL CHECK (asset IN ('usdg', 'eth')),
     amount_in       INTEGER NOT NULL,                 -- micro-USDC sent
     min_out         TEXT    NOT NULL,                 -- the least 1Click delivers, in the asset's smallest unit
     deposit_address TEXT    NOT NULL UNIQUE,
     status          TEXT    NOT NULL CHECK (status IN ('quoted', 'sent', 'done', 'refunded', 'failed', 'stuck')),
     oneclick_status TEXT    NOT NULL DEFAULT '',
     deposit_tx      TEXT    NOT NULL DEFAULT '',
     error           TEXT    NOT NULL DEFAULT '',
     deadline        INTEGER NOT NULL,                 -- ms; the end of 1Click's deposit window
     balance_before  TEXT    NOT NULL DEFAULT '0',     -- the warehouse's balance of the asset when the refill was decided
     balance_at      INTEGER NOT NULL DEFAULT 0,       -- ms of that reading
     checked_at      INTEGER NOT NULL,
     created_at      INTEGER NOT NULL                  -- the daily cap counts by it
   );
   CREATE INDEX warehouse_funding_created ON warehouse_funding(created_at);
   -- what each finished swap cost in gas (wei), from its receipt
   ALTER TABLE warehouse_swaps ADD COLUMN gas_wei TEXT NOT NULL DEFAULT '0';`,
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

/** Runs one statement; returns how many rows it changed. */
export function run(db: Db, sql: string, ...params: SQLInputValue[]): number {
  return Number(db.prepare(sql).run(...params).changes)
}

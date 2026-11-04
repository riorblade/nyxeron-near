# services/api

**Owner:** Kiel (@riorblade). Spec: [SPEC.md §6](../../SPEC.md).

The game server. Everything that moves credits, stock units or access is decided here, never in the browser.

## Stack

Node 24 (runs `.ts` directly, no build step), [Hono](https://hono.dev), `node:sqlite`, zod, jose.

## Layout

One file per domain, routes and logic together; a test file next to each.

```
src/
  main.ts      start: config, database, server, background jobs
  app.ts       all routes mounted under /api; exports AppType for the web's typed client
  config.ts    environment, validated at start
  db.ts        SQLite, migrations, tx()
  http.ts      error shape { error: "<code>" }, request validation
  ledger.ts    moveCredits: the only way credits change
  …            one file per domain as it lands: relay, onboard, parties, intents, settlement, chainsig (Ghoza), proof
```

## Run

```sh
cp services/api/.env.example services/api/.env   # fill in the Privy app id and secret
pnpm dev:api                                     # http://localhost:8788/api/health
```

## Endpoints

Player and admin routes need `Authorization: Bearer <Privy access token>`. Errors are `{ "error": "<code>" }`. In the
web, use the typed client (`hc<AppType>()` from `hono/client`) instead of writing these by hand.

| Route                            | Who         | Answer                                                                                |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `GET /api/health`                | anyone      | `{ ok, network }`                                                                     |
| `GET /api/quotes`                | anyone      | `{ at, stale, prices: { tsla: { usd, xstockUsd, change24h }, … } }`                   |
| `GET /api/me`                    | player      | `{ id, email, nearAccount, name, credits, banned }`                                   |
| `PATCH /api/me`                  | player      | body `{ name }` (2–24 chars) → the profile                                            |
| `GET /api/me/ledger`             | player      | `{ entries: [{ delta, balance, kind, ref, at }] }`, newest first, last 50             |
| `POST /api/me/demo-credits`      | player      | testnet `DEMO_MODE` only, once a day → `{ credits }`                                  |
| `GET /api/admin/me`              | back office | `{ email, role }` (`owner`, `admin`, `viewer`)                                        |
| `GET /api/admin/users?q=&limit=` | back office | `{ users: [{ id, email, nearAccount, name, credits, banned, lastSeen, createdAt }] }` |

Error codes so far: `unauthorized` (401), `banned`, `not_admin` (403), `bad_request` (400, with `issues`), `not_found`
(404), `too_soon` (429), `identity_unavailable`, `quotes_unavailable` (503), `insufficient_credits` (409).

## Rules

- Money is integers: credits, units. Never floats.
- A credit change and its cause are written in the same `tx()`, with a ledger row.
- New tables or columns: a new migration at the end of `db.ts`; never edit a released one.
- Every error is `{ error: "<code>" }` with a fitting status; clients branch on the code.
- Every route and every money rule has a test.

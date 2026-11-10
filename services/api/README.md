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

## Deploy

Testnet (`NEAR_NETWORK=testnet`, `DEMO_MODE=true`). Mainnet only after the proof run and the team's yes.

**api** (one host with Docker, behind a reverse proxy that already holds 80/443 and terminates TLS):

```sh
git archive HEAD | ssh <host> 'mkdir -p /opt/nyxeron-near && tar -x -C /opt/nyxeron-near'
# once: put the secrets on the host, never in the repo
scp services/api/.env <host>:/opt/nyxeron-near/services/api/.env
ssh <host> 'cd /opt/nyxeron-near && docker compose -f services/api/compose.yml up -d --build'
```

- `Dockerfile`: Node 24 runs the `.ts` sources, no build step; health check on `/api/health`.
- `compose.yml`: SQLite on the `api_data` volume (`/data`), so party ids survive a redeploy. The container joins the
  proxy's Docker network (`PROXY_NETWORK`, default `deploy_default`) as `nyxeron-near-api`. Proxy block (Caddy):

  ```
  api.<domain> {
  	handle /api/* {
  		reverse_proxy nyxeron-near-api:8788
  	}
  	handle {
  		respond 404
  	}
  }
  ```

**web** (Vercel, `vercel.json` at the repo root): builds `apps/web`, serves the SPA, and rewrites `/api/*` to the
api host, so the browser stays on one origin (no CORS). Set `VITE_PRIVY_APP_ID` in the Vercel project; the Privy app
must list the web's domain as an allowed origin.

## Endpoints

Player and admin routes need `Authorization: Bearer <Privy access token>`. Errors are `{ "error": "<code>" }`. In the
web, use the typed client (`hc<AppType>()` from `hono/client`) instead of writing these by hand.

| Route                                  | Who           | Answer                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                      | anyone        | `{ ok, network }`                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/quotes`                      | anyone        | `{ at, stale, prices: { tsla: { usd, change24h, liquidityUsd }, … } }` (token market on Robinhood Chain)                                                                                                                                                                                                                                                                                                                 |
| `GET /api/me`                          | player        | `{ id, email, nearAccount, name, credits, banned }`                                                                                                                                                                                                                                                                                                                                                                      |
| `PATCH /api/me`                        | player        | body `{ name }` (2–24 chars) → the profile                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /api/me/ledger`                   | player        | `{ entries: [{ delta, balance, kind, ref, at }] }`, newest first, last 50                                                                                                                                                                                                                                                                                                                                                |
| `POST /api/me/demo-credits`            | player        | testnet `DEMO_MODE` only, once a day → `{ credits }`                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /api/me/test-dollars`            | player        | testnet `DEMO_MODE` only, once a day, after `/api/onboard`: the relayer sends `TEST_DOLLARS` micro-USDC of Circle's testnet USDC → `{ hash, amount }`                                                                                                                                                                                                                                                                    |
| `POST /api/me/add-money`               | player        | body `{ from: { blockchain, symbol }, amount, refundTo }` (`amount` in the source token, e.g. `"10"`; `refundTo` = the player's address on that chain) → a 1Click quote into the player's **own** NEAR account in USDC: `{ dry, amountIn, amountInFormatted, amountOut, amountOutFormatted, minAmountOut, timeEstimate, intent? }`; `intent.depositAddress` (+ `depositMemo`) is where to send, before `intent.deadline` |
| `POST /api/me/cash-out`                | player        | body `{ to: { blockchain, symbol, address }, amount }` (USDC, $1 … $1,000) → the quote plus `payment`, the exact USDC `ft_transfer` to 1Click's deposit address to sign and send to `/api/relay`; refunds go back to the player's NEAR account                                                                                                                                                                           |
| `GET /api/me/intents`                  | player        | `{ intents: [{ id, kind, status, originAsset, destinationAsset, amountIn, amountOut, depositAddress, deadline, depositTx?, createdAt }] }`, last 20, status from 1Click (checked at most every 10 s)                                                                                                                                                                                                                     |
| `GET /api/me/intents/:id`              | player        | one of them                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /api/admin/me`                    | back office   | `{ email, role }` (`owner`, `admin`, `viewer`)                                                                                                                                                                                                                                                                                                                                                                           |
| `GET /api/admin/users?q=&limit=`       | back office   | `{ users: [{ id, email, nearAccount, name, credits, banned, lastSeen, createdAt }] }`                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/onboard`                    | player        | makes the player's NEAR account usable (0 NEAR transfer + USDC registration, paid by us) → `{ nearAccount, createdTx, registeredTx }`                                                                                                                                                                                                                                                                                    |
| `POST /api/relay`                      | player        | body `{ signedDelegate }` (NEP-366, borsh, base64); relayed only if it is a USDC `ft_transfer_call` to our contract (1 yocto), a USDC `ft_transfer` (1 yocto) of a cash-out's exact amount to its 1Click deposit address (this player's, unexpired, once), or `claim_margin` → `{ hash, ok }`; 422 when it failed on chain or the contract refunded the drink (`error: "refund:<reason>"`)                               |
| `GET /api/config`                      | anyone        | `{ network, contractId, usdcId, quoteKey, menu, testDollars }`; `testDollars` is `{ amount, faucetBalance }` on testnet with `DEMO_MODE`, else `null`                                                                                                                                                                                                                                                                    |
| `GET /api/parties`                     | player        | live parties `{ parties: [{ id, title, host, endsAt, demo }] }`; on testnet with `DEMO_MODE` a House Party (`demo: true`, 10 min, hosted by the relayer) is always live and listed first                                                                                                                                                                                                                                 |
| `POST /api/parties`                    | player (host) | body `{ title, minutes? }` (5–60, default 10) → the party; every priced stock at 1.5× wholesale                                                                                                                                                                                                                                                                                                                          |
| `GET /api/parties/:id`                 | player        | `{ id, chainParty, title, host, seed, startsAt, endsAt, live, menu: [{ token, ticker, name, price, wholesale, maxPrice }] }` (micro-USDC); `chainParty` (`<install>-<id>`) is the id the contract knows the party by: pass it to `owed` / `party_pot`                                                                                                                                                                    |
| `PUT /api/parties/:id/prices`          | host          | body `{ prices: { tsla: 800000 } }`, each within wholesale … 3× wholesale                                                                                                                                                                                                                                                                                                                                                |
| `POST /api/parties/:id/quote`          | player        | body `{ token, qty }` (1–20) → `{ quote, payment }`: `payment` is the exact `ft_transfer_call` to sign and send to `/api/relay`; valid 60 s                                                                                                                                                                                                                                                                              |
| `GET /api/parties/:id/settlement`      | player        | `{ status, ops: [{ kind, token?, units?, hash?, status }] }`; status `live` → `waiting` → `pending` → `done` (or `failed`), `off` without an owner key; ops are `release`, `mint` per token, `settle` per batch of ≤ 32 guests                                                                                                                                                                                           |
| `GET /api/admin/settlement`            | back office   | `{ failed: [{ id, party, kind, attempts, error, updatedAt }] }`, settlement steps out of retries                                                                                                                                                                                                                                                                                                                         |
| `POST /api/admin/settlement/:op/retry` | owner, admin  | runs a failed step again (it checks the chain first, so it never doubles a step) → `{ ok }`                                                                                                                                                                                                                                                                                                                              |

Error codes so far: `unauthorized` (401); `banned`, `not_admin`, `not_host`, `wrong_sender`, `wrong_key`,
`bad_signature`, `receiver_not_allowed`, `method_not_allowed`, `deposit_not_allowed`, `gas_too_high`, `one_call_only`,
`bad_args`, `not_testnet`, `demo_off`, `read_only`, `amount_not_allowed`, `cash_out_paid`, `cash_out_expired` (403); `bad_request`, `bad_delegate`, `unknown_token`, `below_wholesale`, `above_cap`, `unknown_asset`, `bad_amount` (400); `not_found`,
`no_party`, `no_failed_op`, `no_intent` (404); `no_near_account`, `insufficient_credits`, `party_over`, `party_not_live`, `reprice_needed`,
`host_has_no_near_account`, `not_onboarded`, `not_enough_usdc` (409); `faucet_failed`, `quote_failed` (502); `too_soon`, `too_many` (429); `identity_unavailable`, `quotes_unavailable`,
`relayer_off`, `quotes_off`, `faucet_off`, `faucet_empty`, `intents_off`, `intents_unavailable` (503).

## Add money and Cash out (`intents.ts`)

NEAR Intents 1Click, non-custodial both ways (spike 05). Asset ids come only from 1Click's `/v0/tokens` (cached 10
min); the player's USDC is `nep141:<USDC_CONTRACT_ID>`.

- **Add money:** a quote from any listed asset into the player's own NEAR account (`recipientType: DESTINATION_CHAIN`).
  1Click registers USDC storage on delivery. A refund goes back to `refundTo` on the source chain.
- **Cash out:** a quote from the player's USDC to their address on another chain, refunds to their NEAR account. The
  player signs the USDC `ft_transfer` to the deposit address; the relay accepts it only for that player's open quote,
  its exact amount, once (`deposit_tx`), then tells 1Click (`/v0/deposit/submit`, best effort). The deposit address
  is a fresh implicit account USDC doesn't know, and a transfer to it would panic (`not registered`), so the relayer
  first registers it on USDC (`storage_deposit`, 0.00125 NEAR), only for a player who holds the amount
  (`not_enough_usdc`, 409, otherwise).
- **Testnet:** 1Click has no testnet (SPEC §10), so every quote is a dry run against mainnet ids: real numbers, no
  deposit address, nothing stored and nothing to sign (`dry: true`).
- Without `ONECLICK_JWT`, 1Click adds 0.25 % to every quote.

## Settlement (`settlement.ts`)

A timer (every 10 s, only with `OWNER_ACCOUNT_ID` / `OWNER_KEY`) takes each party 90 s after it ends (quotes stay valid
60 s) through:

1. `release_wholesale(party)`.
2. `mint_warehouse(token, units, proof)` per token for the total owed. On testnet the proof is `demo:<party>:<token>:1`
   (the purchase is simulated, SPEC §10). On mainnet `buyShares` will buy through 1Click + Kyber + `chainsig.ts`; until
   then the party stops with `not_built`.
3. `settle(party, party:<id>:<batch>, ≤ 32 transfers)` from the contract's `owed(party)`.

Every step is a row in `chain_ops`. The job runs one transaction at a time and checks the chain before each send
(`party_pot`, `is_used_proof`, `is_settled`), so a crash or a lost answer never doubles a step. A failed step retries
after 15 s, 30 s, 60 s …; after 5 tries the party stops and shows in `/api/admin/settlement`.

## Rules

- Money is integers: credits, units. Never floats.
- A credit change and its cause are written in the same `tx()`, with a ledger row.
- New tables or columns: a new migration at the end of `db.ts`; never edit a released one.
- Every error is `{ error: "<code>" }` with a fitting status; clients branch on the code.
- Every route and every money rule has a test.

# Spike findings

What we ran, what we saw, what it means. Newest decisions at the top; raw output in `results/`.

## Decisions so far

| Question                                                                 | Answer from spikes                                                                                                                                         | Spike  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Is NEAR fast enough for on-chain purchases during a party?               | Yes: blocks ~0.64 s, final in ~1.9 s on mainnet                                                                                                            | 01     |
| Can we make testnet accounts for demos without a wallet?                 | Yes: faucet API, 10 NEAR each, ~2.7 s per account                                                                                                          | 02     |
| Can the player act with zero NEAR, gas paid by us?                       | Yes: meta tx, player pays 0, relayer ~0.000239 NEAR (≈ $0.001) per call                                                                                    | 03     |
| Who pays the 1 yocto that `ft_transfer_call` needs?                      | The relayer (tested)                                                                                                                                       | 03     |
| Can a session key (function-call key) do purchases that need 1 yocto?    | **No**: `DepositWithFunctionCall` error, even through a relayer                                                                                            | 03     |
| Is one free RPC enough for the backend?                                  | **No**: FastNEAR free hit 429 within a few dozen calls; fail over across several                                                                           | 03     |
| Can a brand-new player with 0 NEAR be onboarded and act?                 | Yes: relayer creates the implicit account (0 NEAR transfer), registers USDC, player then acts via meta tx; ≈ 0.0086 NEAR (≈ $0.034) per player             | 04     |
| Can a player top up from any chain straight into their own NEAR account? | Yes: 10 USDC Base → 9.994 USDC, ~35 s; SOL works too; 1Click registers USDC storage itself (≈ $0.005)                                                      | 05     |
| Can a player cash out to any chain?                                      | Yes: 10 USDC NEAR → 9.996 USDC Base, ~22 s                                                                                                                 | 05     |
| Can top-ups land directly in our contract?                               | Quotes accept `customRecipientMsg` (delivered with `ft_transfer_call`); needs a live test                                                                  | 05     |
| Can players own real stocks on NEAR (Ondo) through Intents?              | Only in the player's `intents.near` balance, and **only in some lot sizes**: $10/$50/$100 fill, $1–5 never, $20 failed 3×; sells ≥ ~$10 fill               | 05     |
| Does an Ondo token track its share?                                      | Roughly: TSLAon −2.6 %, NVDAon +1.2 %, SPYon +1.4 % vs the share; tiny supply on NEAR (148 TSLAon ≈ $57k)                                                  | 06     |
| Which price should a drink use?                                          | The token's market price, not `stockData`: off US hours the share price is the last close while tokens trade 24/7 (TSLAx −3 %, TSLAon −2.6 % at 07:29 UTC) | 06, 07 |
| Can xStocks be bought in small amounts?                                  | Yes on Jupiter: $1 USDC → TSLAx, 0.03 % impact; unsigned tx 478–697 bytes (fits the 1232-byte signer limit)                                                | 07     |
| Do we need a Jupiter API key?                                            | Not today: `api.jup.ag/price/v3` and `/swap/v2/order` answered without one                                                                                 | 07     |

## 01 · NEAR RPC (2026-11-04)

**Ran:** `status` and blocks on mainnet and testnet through FastNEAR's free RPC.

**Saw:**

|                          | mainnet           | testnet              |
| ------------------------ | ----------------- | -------------------- |
| Binary / protocol        | 2.14.0 / **86**   | 2.14.0-rc.5 / **88** |
| Average block (last 200) | 644 ms            | 583 ms               |
| Final block lags head by | 2 blocks (~1.9 s) | 2 blocks (~1.7 s)    |
| RPC round trip from here | 53 ms             | 244 ms               |

**Means:**

- A purchase is final in about 2 s: fine with an optimistic UI (the drink appears at once, the chain confirms behind).
- Testnet runs a newer protocol than mainnet. Anything that needs protocol 87/88 (universal accounts) works on
  testnet but **not yet on mainnet**: don't build on it.

## 02 · Testnet accounts from the faucet (2026-11-04)

**Ran:** `POST https://helper.nearprotocol.com/account` (the service near-cli uses) twice with fresh ed25519 keys, then
a 0.01 NEAR transfer between the two accounts.

**Saw:** both accounts created in 5.5 s total, **10 NEAR each**. First transfer
([`DGia2r…`](https://testnet.nearblocks.io/txns/DGia2rxMiWVAtQdVju8oyuB4tDGD34eu54TiNxMJsuFV)) came back in 2.8 s.

**Means:** the testnet demo can create accounts by script (judges, bots, fresh players) with no wallet. Keys for the
spike accounts live in `spikes/.env`, never in git.

## 03 · Meta transactions (NEP-366) on testnet (2026-11-04)

**Ran:** the player signs a `DelegateAction` calling `add_message` on `guestbook.near-examples.testnet`; the relayer
submits it with `relayMetaTransaction`. Balances read 8 s later (after gas refunds land). Four cases:

| Case                                              | Result                                                                                      | Player paid                             | Relayer paid                | Tx                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| a) full-access key, no deposit                    | ✅ 2.7 s                                                                                    | 0                                       | 0.000239 NEAR               | [`Hzo9VF…`](https://testnet.nearblocks.io/txns/Hzo9VFsWJ8ZSDbvhAqoihF6Ems6RuPi1BW6JdeVqmHjD) |
| b) full-access key, 1 yocto deposit               | ✅ 2.9 s                                                                                    | 0                                       | 0.000239 NEAR **+ 1 yocto** | [`Gpep3G…`](https://testnet.nearblocks.io/txns/Gpep3G6W6LR2FTnJdf6FLJWVkhrKTKLmshz6EZNGgDFL) |
| c) function-call key (guestbook only), no deposit | ✅ 2.8 s                                                                                    | −0.000189 (refund landed on the player) | 0.000239 NEAR               | [`Hijppm…`](https://testnet.nearblocks.io/txns/HijppmcftLXeWyV17BER3zxHrbPRL5FnHmCx62ttPru8) |
| d) function-call key, 1 yocto deposit             | ❌ `AccessKeyDepositWithFunctionCallActionError: Deposit is not allowed with function call` | —                                       | —                           | —                                                                                            |

Also seen: balances read right after the call showed the relayer down 0.031 NEAR; the unused gas came back a few
seconds later. Measure costs only after refunds.

**Means:**

- Gasless play works: the player never needs NEAR. Cost to us ≈ $0.001 per on-chain action.
- The relayer pays any attached deposit, so it **must** refuse delegates with deposit above 1 yocto, other receivers,
  other methods, or more than one action. Otherwise anyone can drain it.
- A browser-held function-call key (session key) can't do USDC payments (`ft_transfer_call` needs 1 yocto). Purchases
  need either the player's full key (Privy signs it, spike 10) or a balance already inside our contract.
- The backend needs several RPC endpoints with failover (or a paid key); one free endpoint is not enough.

## 04 · Onboarding a player with no NEAR (testnet, 2026-11-04)

**Ran:** a fresh ed25519 key → implicit account id (what a Privy NEAR wallet is). Then, all paid by the relayer: a
0 NEAR transfer, USDC `storage_deposit`, one call signed by the player, and adding a function-call key, both through
meta transactions.

**Saw** (player `3cae3a05…93dc`):

| Step                                       | Result                                                                                                        | Relayer paid                         | Player account after                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| Before anything                            | account does not exist (`UNKNOWN_ACCOUNT`)                                                                    | —                                    | —                                    |
| 0 NEAR transfer                            | created, 2.2 s ([`CPNPdF…`](https://testnet.nearblocks.io/txns/CPNPdFrASHBTbeTPQRgzBCvS2Aw1d93hPXmsw9bCwGPT)) | 0.00711 NEAR                         | balance 0, storage 182 B             |
| USDC `storage_deposit` (registration only) | registered, 3.5 s                                                                                             | 0.00149 NEAR (0.00125 deposit + gas) | `storage_balance_of` = 0.00125       |
| Player call via relayer                    | ✅ ([`7SFxuf…`](https://testnet.nearblocks.io/txns/7SFxufzbbebpjLqX1qSGQ8CnCWZPq6waS8B1crJNa2QA))             | ~0.00024 NEAR                        | balance still 0                      |
| Add a function-call key via relayer        | ✅ 4.8 s ([`DhJSck…`](https://testnet.nearblocks.io/txns/DhJSckhKya2Fei111G6ihHsBo62sUQvaeMs62uSqP8iP))       | ~0.00024 NEAR                        | storage 319 B (under the free 770 B) |

**Means:**

- A Privy NEAR wallet can be made usable with no NEAR from the player: one relayer transfer + one USDC registration,
  **≈ 0.0086 NEAR (≈ $0.034 at $3.94) per player**, once.
- The player's account can hold an extra session key without any NEAR (stays under the free storage).
- 1Click also registers USDC on delivery (spike 05), so our registration is only needed if the player receives USDC
  from us first.

## 05 · NEAR Intents 1Click, mainnet dry quotes (2026-11-04)

**Ran:** `GET /v0/tokens` and `POST /v0/quote` with `dry: true` (no deposit address, nothing sent). Player = the real
implicit id from spike 04.

**Saw:**

| Quote                                                           | Result                                                      | In → out                     | Fees seen                                        | Est. time |
| --------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------ | --------- |
| Top-up 10 USDC Base → USDC in player account                    | ✅                                                          | $9.994 → 9.994 USDC          | `withdrawFee` 0.0049 USDC (storage registration) | 35 s      |
| Top-up 0.1 SOL → USDC in player account                         | ✅                                                          | $9.29 → 9.27 USDC            | 0.0049 USDC                                      | 20 s      |
| Top-up → player `intents.near` balance                          | ✅                                                          | → 9.999 USDC                 | 0                                                | 35 s      |
| Top-up → contract via `ft_transfer_call` (`customRecipientMsg`) | ✅ quote                                                    | → 9.999 USDC                 | 0                                                | 35 s      |
| Cash-out 10 USDC → Base                                         | ✅                                                          | → 9.996 USDC                 | 0.0024                                           | 22 s      |
| Fund Solana: 10 USDC → USDC on Solana                           | ✅                                                          | → 9.989                      | 0.0100                                           | 17 s      |
| Fund Solana: 1 USDC → SOL                                       | ✅                                                          | → 0.0106 SOL ($0.985)        | 107,371 lamports (0.000107 SOL)                  | 19 s      |
| Ondo TSLAon, `DESTINATION_CHAIN` to a NEAR account              | ❌ `recipient is not valid`                                 | —                            | —                                                | —         |
| Ondo TSLAon, `DESTINATION_CHAIN` to an EVM address              | ✅ = withdraws off NEAR to its origin chain                 | —                            | —                                                | 23 s      |
| Ondo TSLAon → player `intents.near` balance, $10 / $50 / $100   | ✅                                                          | $9.99 → $9.91 (≈ 0.8 % cost) | 0                                                | 20 s      |
| Same, $1 / $2 / $3 / $5                                         | ❌ `No liquidity available` (every try, also one at a time) | —                            | —                                                | —         |
| Same, $7                                                        | ✅ once                                                     | —                            | —                                                | —         |
| Same, $20                                                       | ❌ 3 tries                                                  | —                            | —                                                | —         |
| NVDAon $10 / $50                                                | ✅                                                          | $9.94 / $49.69               | —                                                | —         |
| Sell TSLAon 0.005 (≈ $2)                                        | ❌ no liquidity                                             | —                            | —                                                | —         |
| Sell TSLAon 0.026 / 0.05 / 0.1 (≈ $10–38)                       | ✅ ≈ 0.5 % cost                                             | —                            | —                                                | —         |

Also seen:

- `/v0/tokens` lists 215 tokens and **no tokenized stocks**; Ondo tokens quote by asset id
  (`nep141:bnb-0x…omdep.near`) even though they aren't listed.
- 1Click validates addresses strictly: `0x…dEaD` and `fff…f` (not an ed25519 key) are refused.
- No fee for missing JWT showed up in `appFees` today (docs say 25 bps).

**Means:**

- Top-up from any chain into the player's own account and cash-out to any chain: **ready** (non-custodial, ~20–35 s).
- Real stocks via Ondo work only as **batched lots of about $10+**, held in the player's `intents.near` balance, with a
  market that sometimes refuses sizes. Never one swap per drink. Treat Ondo liquidity as unreliable: a buy must be
  retried or fall back.
- Ondo tokens on NEAR are bridged from chain 56 (their ids start with `bnb-`): the team must decide whether that's
  acceptable.

## 06 · Ondo stock tokens on NEAR, mainnet read-only (2026-11-04)

**Ran:** `ft_metadata`, `ft_total_supply`, `storage_balance_bounds` on the three Ondo contracts; a $50 dry quote for
each; the real share price from Jupiter's `stockData`.

**Saw:**

| Token                             | Contract                     | Decimals | Supply on NEAR  | Price via 1Click ($50) | Share price | Token vs share |
| --------------------------------- | ---------------------------- | -------- | --------------- | ---------------------- | ----------- | -------------- |
| Tesla (Ondo Tokenized)            | `bnb-0x2494…9d93.omdep.near` | 18       | 147.96 (≈ $56k) | $381.22                | $391.47     | **−2.62 %**    |
| NVIDIA (Ondo Tokenized)           | `bnb-0xa9ee…6f75.omdep.near` | 18       | 75.27 (≈ $16k)  | $208.49                | $206.11     | +1.15 %        |
| SPDR S&P 500 ETF (Ondo Tokenized) | `bnb-0x6a70…331a.omdep.near` | 18       | 16.19 (≈ $12k)  | $762.87                | $752.13     | +1.43 %        |

Storage registration for each: 0.00125 NEAR (same as USDC).

**Means:**

- The tokens are real NEP-141 contracts a NEAR account can hold, but the amounts bridged to NEAR are tiny, which
  explains the patchy liquidity in spike 05.
- A token can sit a few percent off its share. Pricing drinks from the share price while buying Ondo tokens would
  leave a gap the game has to absorb or show.
- Not tested yet: withdrawing an Ondo token from the `intents.near` balance into the player's own NEAR account.

## 07 · Jupiter, Solana read-only (2026-11-04, 07:29 UTC, US market closed)

**Ran:** `price/v3` on `lite-api.jup.ag` and `api.jup.ag`; `swap/v2/order` USDC → TSLAx for $1 and $5 with a taker
address (nothing signed or sent).

**Saw:**

- Both price hosts answered 200 without a key, same data: TSLAx `usdPrice` **$379.85**, `stockData.price`
  **$391.473** (updated 07:28 UTC), `priceChange24h` −5.3 %, liquidity $1.79M. `stockData` and `scaledUiConfig`
  aren't in Jupiter's docs.
- `$1` order: 200 in 331 ms, route Riptide (router `metis`), out 262,843 raw (0.00262843 TSLAx), price impact
  0.03 %, **unsigned tx 478 bytes**.
- `$5` order: route JupiterZ (RFQ), out 1,307,428 raw, impact 0.02 %, **unsigned tx 697 bytes**.

**Means:**

- The token-vs-share gap seen in spike 06 is mostly market hours: tokens trade 24/7, `stockData` holds the last
  close. A drink must be priced from the token we actually buy (xStock or Ondo market price), or the platform sells
  below cost overnight. Fix `services/api/src/quotes.ts` accordingly.
- Solana liquidity for xStocks is much deeper than Ondo on NEAR: $1 swaps fill.
- Swap transactions fit inside the Chain Signatures payload limit, so an MPC-controlled Solana address can buy.
- `lite-api.jup.ag` still works but is being phased out: use `api.jup.ag`.

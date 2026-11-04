# Spike findings

What we ran, what we saw, what it means. Newest decisions at the top; raw output in `results/`.

## Decisions so far

| Question                                                                 | Answer from spikes                                                                                                                                                  | Spike  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Is NEAR fast enough for on-chain purchases during a party?               | Yes: blocks ~0.64 s, final in ~1.9 s on mainnet                                                                                                                     | 01     |
| Can we make testnet accounts for demos without a wallet?                 | Yes: faucet API, 10 NEAR each, ~2.7 s per account                                                                                                                   | 02     |
| Can the player act with zero NEAR, gas paid by us?                       | Yes: meta tx, player pays 0, relayer ~0.000239 NEAR (≈ $0.001) per call                                                                                             | 03     |
| Who pays the 1 yocto that `ft_transfer_call` needs?                      | The relayer (tested)                                                                                                                                                | 03     |
| Can a session key (function-call key) do purchases that need 1 yocto?    | **No**: `DepositWithFunctionCall` error, even through a relayer                                                                                                     | 03     |
| Is one free RPC enough for the backend?                                  | **No**: FastNEAR free hit 429 within a few dozen calls; fail over across several                                                                                    | 03     |
| Can a brand-new player with 0 NEAR be onboarded and act?                 | Yes: relayer creates the implicit account (0 NEAR transfer), registers USDC, player then acts via meta tx; ≈ 0.0086 NEAR (≈ $0.034) per player                      | 04     |
| Can a player top up from any chain straight into their own NEAR account? | Yes: 10 USDC Base → 9.994 USDC, ~35 s; SOL works too; 1Click registers USDC storage itself (≈ $0.005)                                                               | 05     |
| Can a player cash out to any chain?                                      | Yes: 10 USDC NEAR → 9.996 USDC Base, ~22 s                                                                                                                          | 05     |
| Can top-ups land directly in our contract?                               | Quotes accept `customRecipientMsg` (delivered with `ft_transfer_call`); needs a live test                                                                           | 05     |
| Can players own real stocks on NEAR (Ondo) through Intents?              | Only in the player's `intents.near` balance, and **only in some lot sizes**: $10/$50/$100 fill, $1–5 never, $20 failed 3×; sells ≥ ~$10 fill                        | 05     |
| Does an Ondo token track its share?                                      | Roughly: TSLAon −2.6 %, NVDAon +1.2 %, SPYon +1.4 % vs the share; tiny supply on NEAR (148 TSLAon ≈ $57k)                                                           | 06     |
| Which price should a drink use?                                          | The token's market price, not `stockData`: off US hours the share price is the last close while tokens trade 24/7 (TSLAx −3 %, TSLAon −2.6 % at 07:29 UTC)          | 06, 07 |
| Can xStocks be bought in small amounts?                                  | Yes on Jupiter: $1 USDC → TSLAx, 0.03 % impact; unsigned tx 478–697 bytes (fits the 1232-byte signer limit)                                                         | 07     |
| Do we need a Jupiter API key?                                            | Not today: `api.jup.ag/price/v3` and `/swap/v2/order` answered without one                                                                                          | 07     |
| Can a NEAR account sign Solana transactions (Chain Signatures)?          | Yes: testnet MPC signed a real 420-byte Jupiter swap message in 6.2 s; signature verifies against the derived key = Solana address                                  | 08     |
| Are `rpc.mainnet.near.org` / `rpc.testnet.near.org` usable?              | **No**: deprecated, they answer every call with an error                                                                                                            | 08     |
| Is there a second market for Ondo tokens on NEAR (Rhea)?                 | **No**: 0 Rhea pools hold TSLAon/NVDAon/SPYon (of 2,465 pools)                                                                                                      | 09     |
| Can a NEAR contract read stock prices on-chain?                          | **No**: OutLayer `get_price_data` returns `price: null` even for NEAR via the free view, and lists no stocks; Pyth no longer serves NEAR                            | 09     |
| Is NEAR AI Cloud usable for AI guests later?                             | Yes, the model list is public: 64 models (Claude, Gemini, DeepSeek, Kimi, …); calls need an API key                                                                 | 09     |
| Are there real tokenized stocks with deep liquidity on Robinhood Chain?  | Yes: genuine TSLA/NVDA/SPY verified on-chain; $1 USDG → TSLA fills at ≈ 0.2 % + $0.015 gas, $5–50 almost no slippage                                                | 15     |
| Can NEAR Intents fund Robinhood Chain?                                   | Yes: 10 USDC NEAR → 9.905 USDG (≈ 19 s), 1 USDC → ETH for gas (≈ 21 s)                                                                                              | 15     |
| Are lookalike stock tokens a real risk?                                  | Yes: a fake "NVIDIA Robinhood Token" with 1B supply sits in DEX search; a third-party registry pointed TSLA at an address with no code. Only trust the beacon check | 15     |
| Can the issuer act on holders?                                           | Yes: the shared implementation has `isBlocked(address)`, `pause()`, `burn(address,uint256)`; the sequencer also filters transactions for compliance                 | 15     |
| Can a NEAR account sign Robinhood Chain (EVM) transactions?              | Yes: testnet MPC signed a real 3.3 KB USDG → TSLA swap in 5.7 s; the recovered signer = the derived address                                                         | 16     |
| Can we reach Robinhood from Indonesia?                                   | Robinhood's own domains (docs, official RPC) resolve to an ISP block page; public RPCs (publicnode, drpc) work                                                      | 15     |

## Still to test

| #   | What                                                                                                                                                                                                                                                                                | Owner        | How                                                  | Needs                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------- | --------------------- |
| 10  | Privy NEAR wallet: `createWallet({ chainType: 'near' })`, `signRawHash` with **no UI** on first login, returning login, mobile Safari; sign a NEP-366 delegate with it and relay it (spike 03 relayer); backend `GET https://api.privy.io/v1/users/{id}` shows `chain_type: 'near'` | Wisnu        | small page from `near-examples/hello-privy`, testnet | Privy app id + secret |
| 11  | NEP-245 with `near-sdk-contract-tools` 4.0 (`#[derive(MultiToken)]`): build, sandbox test, deploy to testnet                                                                                                                                                                        | Ghoza        | `cargo near new`, near-sdk 5.30                      | —                     |
| 12  | Live top-up ≈ $1 from Base into a player account, then cash-out back; check what a NEAR-origin `depositAddress` looks like                                                                                                                                                          | Kiel         | `05-intents.ts --live`                               | team's yes, ≈ $2      |
| 13  | Live Ondo buy of $10 into the player's `intents.near` balance, withdraw it to the player's own NEAR account, sell it back                                                                                                                                                           | Kiel         | `05-intents.ts --live`                               | team's yes, ≈ $10     |
| 14  | Mainnet Chain Signatures: derived address on `v1.signer`, fund with ≈ $2 USDC + SOL via 1Click, broadcast a $1 TSLAx swap                                                                                                                                                           | Kiel + Ghoza | `08-chain-signatures.ts --live`                      | team's yes, ≈ $3      |

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
  (by their NEAR contract id) even though they aren't listed.
- 1Click validates addresses strictly: `0x…dEaD` and `fff…f` (not an ed25519 key) are refused.
- No fee for missing JWT showed up in `appFees` today (docs say 25 bps).

**Means:**

- Top-up from any chain into the player's own account and cash-out to any chain: **ready** (non-custodial, ~20–35 s).
- Real stocks via Ondo work only as **batched lots of about $10+**, held in the player's `intents.near` balance, with a
  market that sometimes refuses sizes. Never one swap per drink. Treat Ondo liquidity as unreliable: a buy must be
  retried or fall back.
- Ondo tokens on NEAR are bridged in from another chain, and their contract ids name it: the team decides whether that's
  acceptable.

## 06 · Ondo stock tokens on NEAR, mainnet read-only (2026-11-04)

**Ran:** `ft_metadata`, `ft_total_supply`, `storage_balance_bounds` on the three Ondo contracts; a $50 dry quote for
each; the real share price from Jupiter's `stockData`.

**Saw:**

| Token                             | Contract          | Decimals | Supply on NEAR  | Price via 1Click ($50) | Share price | Token vs share |
| --------------------------------- | ----------------- | -------- | --------------- | ---------------------- | ----------- | -------------- |
| Tesla (Ondo Tokenized)            | (bridged NEP-141) | 18       | 147.96 (≈ $56k) | $381.22                | $391.47     | **−2.62 %**    |
| NVIDIA (Ondo Tokenized)           | (bridged NEP-141) | 18       | 75.27 (≈ $16k)  | $208.49                | $206.11     | +1.15 %        |
| SPDR S&P 500 ETF (Ondo Tokenized) | (bridged NEP-141) | 18       | 16.19 (≈ $12k)  | $762.87                | $752.13     | +1.43 %        |

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

## 08 · Chain Signatures → Solana, testnet MPC (2026-11-04)

**Ran:** on `v1.signer-prod.testnet` (version 3.18.0): `public_key {domain_id: 1}`, `derived_public_key` for our
account + path `nyxeron-warehouse-sol`; built a real $1 USDC → TSLAx Jupiter transaction for the derived address;
called `sign` with the message bytes (1 yocto, 250 TGas); verified the signature with Node's Ed25519.

**Saw:**

- Root Ed25519 key `ed25519:6vSE…3Un2`; derived key `ed25519:DXAH…SbQQ`. The derived key's base58 string **is** the
  Solana address `DXAHvbovcp8CEYeUGLV2unndKp7ro3N8v6NVmzf8SbQQ` (same 32 bytes, same encoding).
- Jupiter Swap **v2** refused the unfunded address (`Insufficient funds`, and shows a 10 bps fee); Swap **v1** built a
  485-byte v0 transaction with one signer and a 420-byte message.
- `sign` returned in **6.2 s** with `{ scheme, signature }` (64 bytes), not the `{ Ed25519: { signature } }` shape in
  the docs. **The signature verifies** over the message with the derived key.
- `rpc.testnet.near.org` and `rpc.mainnet.near.org` now answer every call with `-429 … ENDPOINT IS DEPRECATED`.

**Means:**

- A NEAR account (or our contract) can own and operate a Solana address with no private key anywhere. Signing takes
  seconds, well inside a Solana blockhash's validity.
- Not tested: broadcasting (needs SOL and USDC on the derived address = mainnet money) and the mainnet MPC
  (`v1.signer`, which derives a different address for the same path).
- The response shape differs from the docs: parse both.

## 09 · Sponsors: Rhea, OutLayer price oracle, NEAR AI Cloud (2026-11-04, read-only)

**Ran:** Rhea's indexer `list-top-pools`; `price-oracle.near` `get_price_data` for `wrap.near` and Ondo Tesla;
`GET https://cloud-api.near.ai/v1/models`.

**Saw:**

- **Rhea:** 2465 pools listed, **none** with an Ondo stock token. Deepest USDC pools: USM/USDC
  ($1.95M TVL), USDC/wNEAR ($1.34M), USDt/USDC ($0.60M).
- **OutLayer oracle:** `get_price_data` answered with `price: null` for both `wrap.near` and TSLAon
  (`recency_duration_sec` 600). Its docs say the free view can be stale; fresh prices need a paid `oracle_call` /
  `request_price_data` (0.02 NEAR deposit). Docs list 21 supported tokens, all crypto, plus "custom data from any
  HTTP API" through OutLayer's TEE.
- **NEAR AI Cloud:** model list is public, 64 models, e.g. anthropic/claude-fable-5, anthropic/claude-fable-5-1, anthropic/claude-haiku-4-5, anthropic/claude-haiku-5-5, anthropic/claude-opus-4-6, anthropic/claude-opus-4-7, … ; inference needs an API key.

**Means:**

- Intents is the only route to Ondo liquidity on NEAR, and it's thin (spike 05).
- No on-chain stock price on NEAR today. A contract that must check a stock price needs a price signed by our server
  (or a custom OutLayer TEE job, untested).
- AI guests/NPCs are possible later via NEAR AI Cloud; not needed for the core loop.

## 15 · Robinhood Chain as the stock backing (mainnet read-only, 2026-11-04)

**Ran:** Robinhood Chain (id 4663) through public RPCs; on-chain checks of five token contracts seen in the wild;
selector scan of the shared implementation; KyberSwap routes USDG → TSLA; 1Click dry quotes to Robinhood Chain.

**Saw:**

- **Chain:** id 4663, blocks every **~0.1 s**, gas 0.02 gwei. Testnet id 46630 exists. `rpc.mainnet.chain.robinhood.com`,
  `rpc.testnet.chain.robinhood.com` and `docs.robinhood.com` resolve to `blockpage.xlaxiata.id` here (ISP block in
  Indonesia); `robinhood-rpc.publicnode.com` and `robinhood.drpc.org` answer.
- **Which tokens are genuine.** Genuine = codehash `0x6c1fdd40…5630` (shared beacon proxy) and EIP-1967 beacon
  `0xe10b6f6b…1b00` (method from a public bot issue; matches all three Robinhood-named tokens):

| Candidate                                        | Name on chain                            | Supply           | Beacon proxy? | Verdict          |
| ------------------------------------------------ | ---------------------------------------- | ---------------- | ------------- | ---------------- |
| `0x322F…003b2d`                                  | Tesla • Robinhood Token                  | 12,938 (≈ $4.9M) | ✅            | **genuine TSLA** |
| `0xC9f9…3Bd4E` (a third-party registry's "TSLA") | — (no code at that address)              | —                | ❌            | wrong            |
| `0xd060…9EEC`                                    | NVIDIA • Robinhood Token                 | 86,462           | ✅            | **genuine NVDA** |
| `0xA328…0f2c`                                    | " NVIDIA Robinhood Token " (spaces)      | 999,999,950      | ❌            | **fake**         |
| `0x117c…4C0C`                                    | SPDR S&P 500 ETF Trust • Robinhood Token | 27,030           | ✅            | **genuine SPY**  |

- **What the token code can do** (implementation `0xb354…5aE2`, selectors found): `paused()`, `pause()`,
  `unpause()`, **`isBlocked(address)`**, **`burn(address,uint256)`**, `mint(address,uint256)`, `uiMultiplier()`,
  `balanceOfUI(address)`, `hasRole(bytes32,address)`. Beosin's review adds 13 roles, an oracle-driven pause, and
  sequencer-level compliance filtering of every transaction against a restricted list.
- **Swaps USDG → TSLA (KyberSwap, no key):**

| In  | TSLA out  | Value out | Gas    | Route              |
| --- | --------- | --------- | ------ | ------------------ |
| $1  | 0.0026205 | $0.998    | $0.015 | Uniswap v3         |
| $5  | 0.0131144 | $4.994    | $0.024 | PMM (market maker) |
| $10 | 0.0262456 | $10.000   | $0.028 | TideFi             |
| $50 | 0.1311593 | $49.975   | $0.028 | TideFi             |

- **Intents:** 10 USDC NEAR → **9.905 USDG** on Robinhood Chain (`withdrawFee` 0.075 USDG), est. 19 s; 1 USDC NEAR →
  0.000417 ETH ($0.97) for gas, est. 21 s.

**Means:**

- Robinhood Chain has what Ondo-on-NEAR lacks: real depth at any size, $1 buys, and Intents delivers USDG straight to
  it.
- Never resolve a stock by name or ticker: pin addresses checked against the beacon proxy.
- The issuer can block, pause or burn tokens at any address, including ours, and the chain filters transactions.
  Holding them for players is custodial and depends on Robinhood's compliance rules.
- Our servers and players in Indonesia can't reach Robinhood's own domains; use public RPCs.

## 16 · Chain Signatures → Robinhood Chain, EVM (testnet MPC, 2026-11-04)

**Ran:** `derived_public_key` with `domain_id: 0` (Secp256k1) for our account + path `nyxeron-warehouse-hood`;
KyberSwap `route/build` for a $1 USDG → TSLA swap from that address; EIP-1559 hash signed by `sign` (1 yocto, 250
TGas); signature assembled and the signer recovered with viem.

**Saw:** derived EVM address `0x7ACa80ff325f7fa47D365631D22597d3f354ee1a`; swap calldata 3,172 bytes to router
`0x6131…37b5`; MPC answered in **5.7 s** with `{ scheme, big_r, s, recovery_id }`; signed tx 3,283 bytes;
**recovered signer = derived address**. Not broadcast (the address holds no USDG or ETH).

**Means:** for EVM, Chain Signatures only signs a 32-byte hash, so transaction size doesn't matter (unlike Solana's
1232-byte message limit), and the tooling (viem) is standard. A NEAR account can operate a Robinhood Chain wallet.

## Robinhood Chain vs Solana xStocks (from spikes 05–08, 15, 16)

|                          | Robinhood Chain                            | Solana xStocks                                              |
| ------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| Liquidity, $1 buy        | ✅ fills, ≈ 0.2 % + $0.015 gas             | ✅ fills, 0.03 % impact                                     |
| Bigger buys              | $5–50 near zero slippage (market makers)   | deep ($2–3M pools)                                          |
| Intents funding          | USDG + ETH ✅                              | USDC + SOL ✅                                               |
| Chain Signatures         | EVM: hash signing, standard tooling ✅     | Ed25519: message ≤ 1232 bytes; chainsig.js lacks v0 support |
| Fake tokens              | many (must pin and verify)                 | mint addresses from the issuer's API                        |
| Issuer controls          | block, pause, burn + sequencer compliance  | permanent delegate, freeze, pause                           |
| Who may hold             | non-US (EU) customers                      | non-US persons                                              |
| Reachable from Indonesia | public RPCs only                           | yes                                                         |
| Testnet                  | chain testnet exists, stock tokens unknown | no xStocks on devnet                                        |

Both work technically. Robinhood is easier to build (EVM signing) and fills small buys well; Solana has fewer fake
tokens and no ISP block. Both make the platform a custodian of issuer-controlled tokens.

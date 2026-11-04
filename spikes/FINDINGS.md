# Spike findings

What we ran, what we saw, what it means. Newest decisions at the top; raw output in `results/`.

## Decisions so far

| Question                                                              | Answer from spikes                                                                                                                             | Spike |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Is NEAR fast enough for on-chain purchases during a party?            | Yes: blocks ~0.64 s, final in ~1.9 s on mainnet                                                                                                | 01    |
| Can we make testnet accounts for demos without a wallet?              | Yes: faucet API, 10 NEAR each, ~2.7 s per account                                                                                              | 02    |
| Can the player act with zero NEAR, gas paid by us?                    | Yes: meta tx, player pays 0, relayer ~0.000239 NEAR (≈ $0.001) per call                                                                        | 03    |
| Who pays the 1 yocto that `ft_transfer_call` needs?                   | The relayer (tested)                                                                                                                           | 03    |
| Can a session key (function-call key) do purchases that need 1 yocto? | **No**: `DepositWithFunctionCall` error, even through a relayer                                                                                | 03    |
| Is one free RPC enough for the backend?                               | **No**: FastNEAR free hit 429 within a few dozen calls; fail over across several                                                               | 03    |
| Can a brand-new player with 0 NEAR be onboarded and act?              | Yes: relayer creates the implicit account (0 NEAR transfer), registers USDC, player then acts via meta tx; ≈ 0.0086 NEAR (≈ $0.034) per player | 04    |

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

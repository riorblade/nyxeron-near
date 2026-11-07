# Mainnet runbook

**Not run yet.** Every step that signs or spends needs the team's yes first (CLAUDE.md). The steps after the deploy
use the api's warehouse buyer and funder, so they assume #64, #66 and #69 are merged and deployed.

Commands are near-cli-rs 0.30 with the legacy keychain (`~/.near-credentials`), the form used for the testnet deploys;
the read-only ones were run against testnet on 2026-11-07. Swap the `<…>` placeholders; nothing below is a secret.
Steps 2–6 cost little on testnet with `network-config testnet` and fresh accounts: rehearse them there first.

## 0. Decide first

| What                                   | Options                                                                         | Ref          |
| -------------------------------------- | ------------------------------------------------------------------------------- | ------------ |
| Account names                          | see the table below                                                             | SPEC §12 D2  |
| Money for the proof run                | ≈ \$20 of USDC plus the NEAR below                                              | SPEC §12 D3  |
| The contract account's full-access key | delete it after setup (no upgrades ever) or keep it offline (upgrades possible) | AUDIT risk 3 |
| The quote key                          | a new ed25519 key for mainnet, not the testnet one                              | AUDIT, Low   |

| Placeholder   | Role                                                                                               | Key the api holds      | NEAR to start |
| ------------- | -------------------------------------------------------------------------------------------------- | ---------------------- | ------------- |
| `<CONTRACT>`  | runs `nyxeron`, holds the warehouse units                                                          | none                   | 5             |
| `<OWNER>`     | the contract's owner: releases, mints, settles                                                     | function-call key only | 1             |
| `<RELAYER>`   | pays players' gas, creates their accounts, registers USDC storage                                  | full access            | 2             |
| `<WAREHOUSE>` | controls the warehouse's Robinhood Chain address (Chain Signatures) and is the contract's treasury | full access            | 1             |

Why those amounts (mainnet, 2026-11-07):

- `<CONTRACT>`: storage costs 10¹⁹ yoctoNEAR a byte. The v2 wasm is 345,655 bytes (≈ 3.46 NEAR) and the testnet
  contract used 353,617 bytes with ten tokens; every purchase and new holder adds a little (README "Numbers").
- `<RELAYER>`: ≈ 0.0071 NEAR per new player account, 0.00125 per USDC registration (players, and each cash-out's
  deposit address, #65), plus gas.
- `<WAREHOUSE>`: each signature attaches 1 yoctoNEAR to `v1.signer` (3.17.0, no fee method) with 250 TGas prepaid,
  and each 1Click deposit registers its address on USDC (0.00125 NEAR, the token's `storage_balance_bounds`).
- `<OWNER>`: release, mint and settle prepay 100, 50 and 300 TGas; unused gas is refunded.

## 1. Build and check

```sh
cd contracts/nyxeron
git log --oneline -1 -- .              # the commit you deploy; write it down
git log --oneline <AUDIT.md's last commit>..HEAD -- src   # anything here = re-run near-contract-audit first
cargo test
cargo near build reproducible-wasm     # Docker; target/near/nyxeron.wasm
shasum -a 256 target/near/nyxeron.wasm   # write it down; step 3 compares it with the chain
```

`view-account-summary` prints the deployed code's SHA-256 in hex ("Local Contract (SHA-256 checksum hex)"); the RPC's
`code_hash` is the same digest in base58. Both checked against `nyxeron.testnet`'s code on 2026-11-07.

## 2. Accounts

For each of `<CONTRACT>`, `<OWNER>`, `<RELAYER>`, `<WAREHOUSE>`, as sub-accounts of a funded team account `<FUNDER>`
(`<name>.<FUNDER>`, a plain create-account action; a new top-level `.near` name goes through a registrar and isn't
covered here):

```sh
near account create-account fund-myself <NEW_ACCOUNT> '<NEAR> NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as <FUNDER> network-config mainnet sign-with-legacy-keychain send
```

## 3. Deploy and init

```sh
near contract deploy <CONTRACT> use-file target/near/nyxeron.wasm with-init-call new json-args '{"owner_id":"<OWNER>"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-legacy-keychain send
near account view-account-summary <CONTRACT> network-config mainnet now   # SHA-256 = step 1
```

## 4. Configure

Signed with `<OWNER>`'s full-access key, before the api gets its own key. `USDC` below is Circle's
`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`.

```sh
call() { near contract call-function as-transaction "$1" "$2" json-args "$3" prepaid-gas '30.0 Tgas' attached-deposit "$4" sign-as <OWNER> network-config mainnet sign-with-legacy-keychain send; }
call <CONTRACT> set_usdc '{"account_id":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"}' '0 NEAR'
call <CONTRACT> set_treasury '{"account_id":"<WAREHOUSE>"}' '0 NEAR'
call <CONTRACT> set_quote_key '{"public_key":"<ed25519 public key of the mainnet QUOTE_KEY>"}' '0 NEAR'
# USDC must know the contract (it holds pots) and the treasury (releases land there), or their transfers fail.
call 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 storage_deposit '{"account_id":"<CONTRACT>","registration_only":true}' '0.00125 NEAR'
call 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 storage_deposit '{"account_id":"<WAREHOUSE>","registration_only":true}' '0.00125 NEAR'
```

The menu, the same ten tokens as `nyxeron.testnet` (its `tokens()` view) and `packages/game/src/menu.ts`:

```sh
reg() { call <CONTRACT> register_token "{\"token_id\":\"$1\",\"info\":{\"symbol\":\"$2\",\"backing\":\"robinhood:$3\",\"shares_per_unit\":\"0.001\"}}" '0 NEAR'; }
reg tsla  TSLA  0x322F0929c4625eD5bAd873c95208D54E1c003b2d
reg nvda  NVDA  0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
reg aapl  AAPL  0xaf3d76f1834a1d425780943c99ea8a608f8a93f9
reg googl GOOGL 0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3
reg meta  META  0xc0d6457c16cc70d6790dd43521c899c87ce02f35
reg msft  MSFT  0xe93237c50d904957cf27e7b1133b510c669c2e74
reg spy   SPY   0x117cc2133c37B721F49dE2A7a74833232B3B4C0C
reg qqq   QQQ   0xd5f3879160bc7c32ebb4dc785f8a4f505888de68
reg crcl  CRCL  0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5
reg mstr  MSTR  0xec262a75e413fafd0df80480274532c79d42da09
```

Check: `config()` names the USDC, `<WAREHOUSE>` as treasury, the quote key and `paused: false`; `tokens()` equals
testnet's, byte for byte.

```sh
near contract call-function as-read-only <CONTRACT> config json-args '{}' network-config mainnet now
near contract call-function as-read-only <CONTRACT> tokens json-args '{}' network-config mainnet now
```

## 5. The api's key on `<OWNER>`

Only the three methods settlement calls (`near.ts`), so the api's key can't change the configuration or pause:

```sh
near account add-key <OWNER> grant-function-call-access --allowance '1 NEAR' --contract-account-id <CONTRACT> --function-names 'release_wholesale, mint_warehouse, settle' autogenerate-new-keypair save-to-legacy-keychain network-config mainnet sign-with-legacy-keychain send
```

`<OWNER>`'s full-access key stays offline with the team: it rotates the quote key, pauses, writes off.

## 6. The warehouse address

```sh
near contract call-function as-read-only v1.signer derived_public_key json-args '{"path":"nyxeron-warehouse-hood","predecessor":"<WAREHOUSE>","domain_id":0}' network-config mainnet now
```

The api logs the same address at start (`warehouse 0x… on Robinhood Chain, controlled by <WAREHOUSE>`); both must
agree. It depends on the account, the path and the network, so it is not the testnet one. Put it in the README's
"Deployed" table and on `/proof`.

## 7. The api's environment (Kiel deploys)

`NEAR_NETWORK=mainnet`, `CONTRACT_ID=<CONTRACT>`, `OWNER_ACCOUNT_ID=<OWNER>` + `OWNER_KEY=<the function-call key>`,
`RELAYER_ACCOUNT_ID` + `RELAYER_KEY`, `QUOTE_KEY=<mainnet secret>`, `WAREHOUSE_ACCOUNT_ID=<WAREHOUSE>` +
`WAREHOUSE_KEY`, optionally `ONECLICK_JWT` (without it, 1Click's quotes carried a 0.2 % app fee on 2026-11-07).
`DEMO_MODE` stays off (the config refuses it on mainnet). Never in the repo.

## 8. The first proof run (SPEC §10)

Smallest amounts, one person watching the api log and `GET /api/admin/settlement` (failed steps, `stuck` rows).

One drink's wholesale is cents (0.001 TSLA ≈ \$0.36), and the funder sends nothing under \$5, so first send
**≈ \$15 of USDC to `<WAREHOUSE>`** (it is the treasury): \$5 becomes gas, the rest USDG.

1. **Top-up:** Add money from another chain → USDC in the player's NEAR account.
2. **Drink:** buy one TSLA drink in a party → `purchase` event, margin at the CEO.
3. **Party end:** `release` → the pot lands at `<WAREHOUSE>` as USDC.
4. **Funding:** within a tick the funder sends \$5 → ETH, then what is left (up to \$100) → USDG
   (`warehouse_funding` → `sent` → `done`). Until it lands the buyer waits (`warehouse_low_*`, retried).
5. **Swap:** `warehouse_swaps` → `done`; the tx on the Robinhood Chain explorer shows the token's `Transfer` to the
   warehouse.
6. **Mint + settle:** `mint_warehouse` with the swap hash as proof, then `settle` → units in the guest's account.
7. **Cash-out:** to another chain, `ft_transfer` relayed with the deposit address registered first (#65).

Record each hash for the README's proof table. `/proof`: `mt_supply` per token ≤ the warehouse's `balanceOfUI`.

## 9. Lock down

AUDIT risk 3, the team's decision from step 0. If the contract is never upgraded, remove its full-access key (this
can't be undone):

```sh
near account list-keys <CONTRACT> network-config mainnet now
near account delete-keys <CONTRACT> public-keys ed25519:<its key> network-config mainnet sign-with-legacy-keychain send
```

## When something goes wrong

- **Stop money moving:** `set_paused(true)` with `<OWNER>`'s full-access key. Payments refund, release, mint and
  settle stop; holders keep their units.
- **A `stuck` row** (listed in `GET /api/admin/settlement`): check the tx on nearblocks / the Robinhood Chain explorer
  / the 1Click explorer, then set its `status` to `done` or `failed` in the database. The api never retries it.
- **A failed settlement step:** back office → retry (it checks the chain first).
- **A leaked key:** quote key → `set_quote_key`; api account → `set_owner` + `accept_owner` from a new account;
  the api's function-call key → `delete-keys` on `<OWNER>`; `<WAREHOUSE>` → pause, move its USDC out, and
  point `set_treasury` at a new account (the warehouse address moves with the account: its stock stays at the old one).

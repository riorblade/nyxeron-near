# contracts/nyxeron

**Owner:** Ghoza (@ghozzza). Spec: [SPEC.md §5.2, §6](../../SPEC.md). Issues #13 (v1), #22 (v2).

The NEAR contract that takes drink payments and holds stock units as NEP-245 multi tokens. A unit is a claim on stock
tokens in the platform's warehouse (1 unit = `shares_per_unit` of a share, e.g. 0.001). The warehouse is the
contract's own balance.

A party, end to end:

1. A guest pays a drink in USDC: `ft_transfer_call` to this contract with a quote the api signed. The margin goes
   straight to the party's CEO, the wholesale stays in the party's pot, and the guest is **owed** the units.
2. `release_wholesale(party)` sends the pot to the treasury, which buys the stock on Robinhood Chain.
3. `mint_warehouse` mints the bought units (the swap tx is the proof), and `settle` gives each guest what they are
   owed, never more.

## Deployed

| Network | Contract          | Owner (api)           | Tokens                |
| ------- | ----------------- | --------------------- | --------------------- |
| testnet | `nyxeron.testnet` | `nyxeron-api.testnet` | `tsla`, `nvda`, `spy` |

That deploy is **v1** (no payments, `solana:` backing). v2 goes to a fresh account, see #22.

The api signs with a function-call key on `nyxeron-api.testnet` limited to `nyxeron.testnet` and the owner methods;
it is shared outside the repo. Check it on [nearblocks](https://testnet.nearblocks.io/address/nyxeron.testnet).

## Interface

### Drink payment (`ft_on_transfer`)

The guest's client sends `ft_transfer_call` on USDC (1 yoctoNEAR) with `receiver_id` = this contract, `amount` =
`unit_price × qty` and `msg`:

```json
{
  "quote": "<base64 of the quote JSON bytes>",
  "sig": "<base64 of a 64-byte ed25519 signature over exactly those bytes>"
}
```

The quote, signed by the key set with `set_quote_key`:

```json
{
  "v": 1,
  "id": "q_8f3a",
  "party": "42",
  "buyer": "<guest account>",
  "ceo": "<CEO account>",
  "token": "tsla",
  "qty": 3,
  "unit_price": "410000",
  "unit_wholesale": "390000",
  "expires_ms": 1793780000000
}
```

`qty` and `expires_ms` are JSON numbers, prices are micro-USDC strings. The contract checks the signature over the
bytes it was given, then parses them, so the api may format the JSON any way it likes.

Accepted when all hold, otherwise the **whole amount is refunded** and a `refund` event says why (`reason`):

| Check                                                                                              | `reason`                              |
| -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| the caller is the configured USDC contract                                                         | `wrong_token`                         |
| not paused; a quote key is set                                                                     | `paused`, `no_quote_key`              |
| `msg` parses, the quote is ≤ 1024 bytes, `sig` is 64 bytes and valid                               | `bad_msg`, `bad_signature`            |
| `v == 1`                                                                                           | `bad_version`                         |
| `id`, `party` 1–64 bytes; `ceo` is not this contract                                               | `bad_quote`                           |
| `id` never used before                                                                             | `quote_used`                          |
| `buyer` is the payer (`sender_id`)                                                                 | `buyer_mismatch`                      |
| `token` registered, `qty > 0`, `block_timestamp_ms ≤ expires_ms`                                   | `unknown_token`, `bad_qty`, `expired` |
| `0 < unit_wholesale ≤ unit_price ≤ 3 × unit_wholesale`                                             | `bad_price`                           |
| `amount == unit_price × qty`                                                                       | `bad_amount`                          |
| the party's wholesale was not released yet                                                         | `party_closed`                        |
| `ceo` is the party's CEO, fixed by its first accepted purchase                                     | `ceo_mismatch`                        |
| the party owes fewer than 256 (guest, token) entries, or this guest already has one for this token | `party_full`                          |

Effects: the margin `(unit_price − unit_wholesale) × qty` is sent to `ceo` (if that transfer fails, e.g. the CEO is
not registered on USDC, it waits for `claim_margin`); `unit_wholesale × qty` goes to the party's pot;
`owed[party][buyer][token] += qty`; the first purchase fixes the party's CEO; event `purchase`.

### Owner methods

The api account. None take a deposit, so a function-call key limited to this contract can call them.

| Method                                    | Effect                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new(owner_id)`                           | init                                                                                                                                                                          |
| `set_owner(owner_id)`                     | hand the contract to another api account                                                                                                                                      |
| `set_quote_key(public_key)`               | `ed25519:…` key the api signs quotes with. Quotes signed by the old key stop working                                                                                          |
| `set_usdc(account_id)`                    | the USDC contract, once                                                                                                                                                       |
| `set_treasury(account_id)`                | where released wholesale goes (not this contract)                                                                                                                             |
| `register_token(token_id, info)`          | whitelist a stock. `info = { symbol, backing, shares_per_unit }`, e.g. `{ "symbol": "TSLA", "backing": "robinhood:<token address>", "shares_per_unit": "0.001" }`             |
| `release_wholesale(party)`                | send the party's pot to the treasury and close the party to purchases. If the transfer fails the pot is kept and this can run again; once sent it refuses                     |
| `mint_warehouse(token_id, amount, proof)` | mint `amount` units to the warehouse. `proof` (the purchase tx hash, ≤ 128 bytes) backs one mint only                                                                         |
| `settle(party, op_id, transfers)`         | warehouse → the party's guests, all or nothing, each at most what they are owed. `transfers = [{ account_id, token_id, amount }]`, at most 32. `op_id` (≤ 64 bytes) runs once |
| `write_off(token_id, amount, reason)`     | burn from the warehouse (units that no longer exist). Works while paused                                                                                                      |
| `set_paused(paused)`                      | refund payments and stop `release_wholesale`, `mint_warehouse`, `settle`. Holders can still move units, CEOs can still claim                                                  |

Anyone: `claim_margin()` sends the caller's held margin. Holders: NEP-245 `mt_transfer`, `mt_batch_transfer`,
`mt_transfer_call` (exactly 1 yoctoNEAR; never to yourself).

Views: `owed(party)` → `[{ account_id, token_id, qty }]`, `party_pot(party)` → `{ held, released, ceo }`,
`claimable_margin(account_id)`, `is_used_quote(id)`, `config()`, `mt_balance_of(account_id, token_id)`,
`mt_batch_balance_of`, `mt_supply(token_id)`, `mt_batch_supply`, `mt_token`, `mt_metadata_*`, `tokens()`,
`is_used_proof(proof)`, `is_settled(op_id)`, `is_paused()`, `owner_id()`. Amounts are strings (`U128`).

Events (NEP-297):

- `nyxeron` 1.0.0: `purchase { id, party, buyer, ceo, token, qty, total, margin }`, `refund { sender_id, amount,
reason }`, `margin_held { ceo, amount }`, `release { party, amount }`, `release_failed { party, amount }`.
- `nep245` 1.0.0: `mt_mint` has the proof as memo, `mt_transfer` from a settle has the `op_id`, `mt_burn` has the
  write-off reason.

### Setup after deploy

`set_usdc`, `set_treasury`, `set_quote_key`, `register_token` per stock, and register the contract on USDC
(`storage_deposit` with `account_id` = this contract) so it can hold pots. The CEO and the treasury must be registered
on USDC too, or their transfers fail (margin waits for `claim_margin`, a release can be retried).

## Numbers (sandbox, against a near-contract-standards NEP-141 token)

- A drink payment (`ft_transfer_call` → `ft_on_transfer` → margin `ft_transfer` → callback → resolve): 11.5 TGas
  burnt in the sandbox with a near-contract-standards token, which works from 30 TGas (`probe_client_gas`).
- With Circle's USDC on testnet (2026-11-05, tx `3awpE683wDyPELUDCQUur2fvbmU81DjFBuUzrfdPCZ5h`): 13.6 TGas burnt.
  Circle's token refuses 30 TGas up front ("More gas is required", nothing moves) and works from 40 TGas with the
  margin delivered. The client attaches 100.
- A party at its cap of 256 owed entries: a payment burns 16.0 TGas, a settle of one guest 7.2 TGas
  (`full_party_gas`, ignored by default). Attach 100 TGas, not the 30 minimum.
- The first purchase of a party stores 220 bytes (≈ 0.002 NEAR, from the contract's balance); settling frees the
  owed entry again.
- `settle` of 32 transfers with the longest ids (64-char accounts and `party`, 64-char `op_id`): 23.1 TGas and under
  10,000 of the 16,384 log bytes NEAR allows per call (21.9 TGas, 11,040 bytes with the largest amounts, v1). The log
  cap, not gas, sets the batch limit: every transfer emits an event.
- Wasm: ~250 KB, so about 2.5 NEAR of the contract's balance is locked for code.
- Storage for new holders comes out of the contract's balance (no `storage_deposit`): 141 bytes ≈ 0.0014 NEAR per new
  holder with a 64-char implicit account. Keep the balance topped up. A holder could spread units over many new
  accounts to lock the contract's NEAR, but each new account costs them at least one unit (0.001 share, ~\$0.40 for
  TSLA) against 0.0014 NEAR locked, so it costs the attacker far more than it costs us.

## Notes

- Built on `near-sdk-contract-tools` 4.0.0 (`Nep245`, `Nep245Metadata`). Its NEP-245 transfer reads both balances
  before writing, so a transfer to yourself created units. The contract refuses sender = receiver (`NoSelfTransfer`
  hook, tests `transfer_to_yourself_is_refused`, `batch_transfer_to_yourself_is_refused`).
- near-sdk 5.30 needs Rust 1.95+; `rust-toolchain.toml` pins 1.96.0, the same Rust as the reproducible-build image.
- The contract account must not keep a full-access key on mainnet: anyone holding it could move the warehouse with
  `mt_transfer`.

## Commands

```sh
cargo test                                    # unit tests + sandbox tests (first run downloads the sandbox)
cargo test --test sandbox probe -- --ignored --nocapture   # least gas a payment needs
cargo near build non-reproducible-wasm        # dev build → target/near/nyxeron.wasm
cargo near build reproducible-wasm            # release build (Docker)
```

Mainnet deploys only with the team's yes. Security review: [AUDIT.md](AUDIT.md).

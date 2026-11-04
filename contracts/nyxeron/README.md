# contracts/nyxeron

**Owner:** Ghoza (@ghozzza). Spec: [SPEC.md §5](../../SPEC.md). Issue #13.

The NEAR contract that holds stock units as NEP-245 multi tokens. A unit is a claim on stock tokens in the platform's
warehouse (1 unit = `shares_per_unit` of a share, e.g. 0.001). The warehouse is the contract's own balance. The api's
account is the only one that mints into the warehouse (with a purchase as proof) and settles parties (warehouse →
guests).

## Interface

Owner methods (the api account; none take a deposit, so a function-call key limited to this contract can call them):

| Method                                    | Effect                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `new(owner_id)`                           | init                                                                                                                                                         |
| `register_token(token_id, info)`          | whitelist a stock. `info = { symbol, backing, shares_per_unit }`, e.g. `{ "symbol": "TSLA", "backing": "solana:<xStock mint>", "shares_per_unit": "0.001" }` |
| `mint_warehouse(token_id, amount, proof)` | mint `amount` units to the warehouse. `proof` (the purchase tx: Solana signature or NEAR tx hash, ≤ 128 bytes) backs one mint only                           |
| `settle(op_id, transfers)`                | warehouse → guests, all or nothing. `transfers = [{ account_id, token_id, amount }]`, at most 32. `op_id` (e.g. `party:42`, ≤ 64 bytes) runs once            |
| `write_off(token_id, amount, reason)`     | burn from the warehouse (units that no longer exist). Works while paused                                                                                     |
| `set_paused(paused)`                      | stop `mint_warehouse` and `settle`. Holders can still move their units                                                                                       |

Holders: NEP-245 `mt_transfer`, `mt_batch_transfer`, `mt_transfer_call` (exactly 1 yoctoNEAR; never to yourself).

Views: `mt_balance_of(account_id, token_id)`, `mt_batch_balance_of`, `mt_supply(token_id)`, `mt_batch_supply`,
`mt_token`, `mt_metadata_*`, `tokens()`, `is_used_proof(proof)`, `is_settled(op_id)`, `is_paused()`, `owner_id()`.
Amounts are strings (`U128`).

Events: NEP-297 `nep245` 1.0.0. `mt_mint` has the proof as memo, `mt_transfer` from a settle has the `op_id`, `mt_burn`
has the write-off reason.

## Numbers (sandbox)

- `settle` of 32 transfers with the longest ids (64-char implicit accounts, 64-char `op_id`): 21.9 TGas and 11,040 of
  the 16,384 log bytes NEAR allows per call. The log cap, not gas, sets the batch limit: every transfer emits an event.
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
cargo near build non-reproducible-wasm        # dev build → target/near/nyxeron.wasm
cargo near build reproducible-wasm            # release build (Docker)
```

Mainnet deploys only with the team's yes, after the `near-contract-audit` skill.

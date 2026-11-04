# contracts/nyxeron · security review

Checked on 2026-11-04 against the `near-contract-audit` checklist (near/agent-skills) plus the contract's own business
rules. Code at the commit that adds this file. Re-run before the mainnet deploy if the contract changes.

## Checklist

| Detector                | Result    | Where / why                                                                                                                                                              |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| non-private-callback    | ok        | The only callback, `mt_resolve_transfer` (from near-sdk-contract-tools), is `#[private]`                                                                                 |
| reentrancy              | ok        | Our methods make no cross-contract calls. `mt_transfer_call` moves balances before calling the receiver and resolves after, as NEP-245 requires                          |
| argument / return types | ok        | Amounts are `U128` (strings in JSON) everywhere                                                                                                                          |
| unsaved changes         | ok        | `near_sdk::store` collections are fields of the contract state; sandbox tests read `is_used_proof` / `is_settled` / balances back after each call                        |
| owner check             | ok        | `register_token`, `mint_warehouse`, `settle`, `write_off`, `set_paused` all start with `require_owner`; a unit test per method proves a guest is refused                 |
| yocto attach            | by design | Owner methods take no deposit so the api can call them with a function-call key (SPEC §6.2). Holder transfers require exactly 1 yocto (library)                          |
| storage collision       | ok        | Our prefixes are `BorshStorageKey` variants (`0x00`–`0x02`); the library's slots start with `~` (`~$245`, …)                                                             |
| initialization          | ok        | `#[init] new`, `PanicOnDefault`                                                                                                                                          |
| gas griefing            | ok        | `settle` takes at most 32 transfers (set by the 16 KiB log cap; 21.9 TGas worst case). Other loops are over owner-registered tokens only                                 |
| insecure randomness     | n/a       | No randomness                                                                                                                                                            |
| prepaid gas             | ok        | Only the library's `mt_transfer_call` schedules a callback: 5 TGas static for `mt_resolve_transfer`, and the call requires ≥ 30 TGas prepaid                             |
| cover storage cost      | accepted  | New holders' storage comes from the contract balance: 141 bytes ≈ 0.0014 NEAR each. A holder creating accounts to lock it pays ≥ 1 unit (~\$0.40) per 0.0014 NEAR locked |
| unsafe math             | ok        | No arithmetic in our code; the library uses checked math; `overflow-checks = true` in release                                                                            |
| float math              | ok        | None (`shares_per_unit` is a display string)                                                                                                                             |

## Found and fixed

- **High: a transfer to yourself created units** (near-sdk-contract-tools 4.0 reads sender and receiver balances
  before writing either). Fixed by the `NoSelfTransfer` hook; tests `transfer_to_yourself_is_refused` and
  `batch_transfer_to_yourself_is_refused`.
- **Medium: a full settle failed at 100 transfers** (log cap, not gas). Limit set to 32 with a worst-case sandbox test.

## Risks the team accepts or decides

1. **The api's key is the warehouse's key.** Whoever holds the owner's function-call key can settle the whole warehouse
   to themselves or mint against fake proofs; the contract cannot read Solana. Mitigations: the key is limited to this
   contract and its owner methods, `set_paused` stops mint and settle, and `/proof` + reconciliation (SPEC §6.6) show a
   gap between `mt_supply` and the warehouse. There is no `set_owner`: rotate keys on the owner account instead.
2. **The contract account's own full-access key** can redeploy the code and move the warehouse with `mt_transfer`.
   On mainnet: remove it after deploy (no upgrades) or keep it in a hardware wallet / multisig (upgrades possible).
   Team decision before mainnet.
3. **Token info is final.** `register_token` cannot edit or remove a token; a wrong `backing` needs a new token id.
4. **Units sent to the warehouse stay there.** A holder transferring units to the contract account adds to warehouse
   stock; nothing gives them back.

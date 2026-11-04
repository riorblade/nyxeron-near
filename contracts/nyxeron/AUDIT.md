# contracts/nyxeron · security review

Checked on 2026-11-04 against the `near-contract-audit` checklist (near/agent-skills) plus the contract's own business
rules. v1 (stock units) at the commit that added this file, v2 (drink payments, #22) at the commit that updates it.
Re-run before the mainnet deploy if the contract changes.

## Checklist

| Detector                | Result    | Where / why                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| non-private-callback    | ok        | Callbacks `on_margin_sent`, `on_wholesale_released` and the library's `mt_resolve_transfer` are `#[private]`; ours read `#[callback_result]` and never panic on a failed transfer                                                                                                             |
| reentrancy              | ok        | State is final before every outgoing call: a purchase records quote, pot and owed before the margin transfer; `release_wholesale` zeroes the pot and `claim_margin` removes the balance first, and their callbacks only add back on failure. Sandbox tests cover both failures                |
| argument / return types | ok        | Amounts are `U128` (strings in JSON) everywhere                                                                                                                                                                                                                                               |
| unsaved changes         | ok        | `near_sdk::store` collections are fields of the contract state; sandbox tests read `is_used_proof` / `is_settled` / balances back after each call                                                                                                                                             |
| owner check             | ok        | Every config and warehouse method starts with `require_owner`, including `set_owner`, `set_quote_key`, `set_usdc`, `set_treasury`, `release_wholesale`; a unit test per method proves a guest is refused. `ft_on_transfer` is gated on the configured USDC as caller plus the quote signature |
| yocto attach            | by design | Owner methods take no deposit so the api can call them with a function-call key (SPEC §6.2). Holder transfers require exactly 1 yocto (library). Outgoing `ft_transfer`s attach 1 yocto from the contract                                                                                     |
| storage collision       | ok        | Our prefixes are `BorshStorageKey` variants (`0x00`–`0x06`); the library's slots start with `~` (`~$245`, …)                                                                                                                                                                                  |
| initialization          | ok        | `#[init] new`, `PanicOnDefault`                                                                                                                                                                                                                                                               |
| gas griefing            | ok        | `settle` takes at most 32 transfers (16 KiB log cap; 23.1 TGas). Each party's `owed` list is read and rewritten per purchase, so it is capped at 256 entries (`party_full`): 16.0 TGas per payment at the cap. Only api-signed, paid quotes add entries                                       |
| insecure randomness     | n/a       | No randomness                                                                                                                                                                                                                                                                                 |
| prepaid gas             | ok        | Margin and release transfers get 10 TGas static plus 5 TGas for the callback. A payment works from 30 TGas attached (sandbox probe); with too little gas the promise fails to schedule, `ft_on_transfer` panics, and the token refunds the whole amount                                       |
| cover storage cost      | accepted  | New holders (141 bytes) and a party's first purchase (204 bytes, ≈ 0.002 NEAR) are paid from the contract balance. Holders creating accounts pay ≥ 1 unit (~\$0.40) per 0.0014 NEAR locked; purchases need an api-signed quote and a real payment                                             |
| unsafe math             | ok        | `unit_price × qty` and `3 × unit_wholesale` are checked and refund on overflow (tests); other sums are bounded by USDC supply; `overflow-checks = true` in release                                                                                                                            |
| float math              | ok        | None (`shares_per_unit` is a display string)                                                                                                                                                                                                                                                  |

## Found and fixed

- **High: a transfer to yourself created units** (near-sdk-contract-tools 4.0 reads sender and receiver balances
  before writing either). Fixed by the `NoSelfTransfer` hook; tests `transfer_to_yourself_is_refused` and
  `batch_transfer_to_yourself_is_refused`.
- **Medium: a full settle failed at 100 transfers** (log cap, not gas). Limit set to 32 with a worst-case sandbox test.
- **Medium (v2, found before merge): margin or wholesale could be locked for good.** A quote with `ceo` = this
  contract, or the treasury set to this contract, makes USDC refuse the transfer (to yourself), and no one could claim
  it. Both are refused (`the_contract_as_ceo_is_refunded`, `the_contract_as_treasury_is_refused`).
- **Medium (v2, automated review before merge): a party's `owed` list had no bound.** Every purchase reads and
  rewrites it, so a big enough party would run purchases out of gas (refunded, but the party could not sell). Capped
  at 256 entries with refusal `party_full`; measured 16.0 TGas per payment at the cap.

## Risks the team accepts or decides

1. **The api's key is the warehouse's key.** Whoever holds the owner's function-call key can mint against fake
   proofs (the contract cannot read Robinhood Chain) and release any party's pot to the treasury. Settle is capped by
   what guests are owed, so the key alone cannot send the warehouse to an arbitrary account. Mitigations: the key is
   limited to this contract and its owner methods, `set_paused` stops money movement, `set_owner` rotates the api
   account, and `/proof` + reconciliation (SPEC §6.6) show a gap between `mt_supply` and the warehouse.
2. **The api's quote key sets prices and the margin's destination.** Within the contract's bounds (price ≤ 3 ×
   wholesale, buyer must pay it themselves) the api decides the price, the wholesale split and which account is the
   CEO. A leaked quote key lets someone sell drinks to themselves at any split, but every purchase still costs the
   buyer the full price. Rotate with `set_quote_key`; keep it apart from the owner key.
3. **The contract account's own full-access key** can redeploy the code and move the warehouse with `mt_transfer`.
   On mainnet: remove it after deploy (no upgrades) or keep it in a hardware wallet / multisig (upgrades possible).
   Team decision before mainnet.
4. **Token info is final.** `register_token` cannot edit or remove a token; a wrong `backing` needs a new token id.
5. **Units sent to the warehouse stay there.** A holder transferring units to the contract account adds to warehouse
   stock; nothing gives them back.
6. **USDC is set once.** Pots and held margins are amounts of that token; a different USDC needs a fresh deploy.

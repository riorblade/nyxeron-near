# hood-testnet

Robinhood Chain **testnet** only (chain 46630). Robinhood's stock tokens and USDG don't exist there, so the game's
warehouse buys these instead. None of it is worth anything.

- `TestUSDG`: test dollars, 6 decimals. Only the deployer mints.
- `SyntheticStock`: one per menu item ("Synthetic Tesla (testnet)", `sTSLA`, …), 18 decimals, with the real tokens'
  `uiMultiplier()` (always 1e18 here) and `balanceOfUI`. Only its market mints.
- `SyntheticMarket`: sells a listed stock for `TestUSDG` at a price the poster (the warehouse) keeps current, refusing
  a price older than an hour. `swap` takes KyberSwap's `SwapExecutionParams`, so the api builds, checks and proves a
  testnet purchase with the code it uses on mainnet (`services/api/src/swap.ts`, `market.ts`).

```sh
forge build
forge test        # 11 tests, no dependencies (the cheatcodes used are declared in the test)
```

Deploying: `services/api/README.md`, "Testnet purchases".

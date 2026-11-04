# spikes

**Owner:** Kiel (@riorblade); anyone adds a spike for their lane. Issue #11.

Hands-on tests of everything the product depends on: real RPC calls, real quotes, real transactions. Docs say what
should happen; spikes say what does. Every stack decision cites a spike in [FINDINGS.md](FINDINGS.md).

## Rules

- **Transactions on testnet only.** Mainnet: read-only calls and dry quotes.
- Anything that spends real money is written behind `--live` and runs only after the team says yes.
- Keys live in `spikes/.env` (git ignores it). Never mainnet keys.
- Each spike saves what it saw to `results/<spike>.json` (committed, as evidence) and its verdict goes into
  `FINDINGS.md`: what we ran, what we saw, what it means for the product.

## Run

```sh
pnpm install
node spikes/01-near-rpc.ts          # Node 24 runs .ts directly
```

| Spike                        | Tests                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `01-near-rpc.ts`             | protocol version, block time, finality                                                 |
| `02-testnet-account.ts`      | testnet account from the faucet, first transaction (writes `spikes/.env`)              |
| `03-meta-tx.ts`              | relayer pays gas and deposit; what a function-call key may sign                        |
| `04-onboarding.ts`           | implicit player account via 0 NEAR transfer, storage, USDC registration by the relayer |
| `05-intents.ts`              | 1Click tokens and dry quotes: top-up, cash-out, Ondo stocks, Solana                    |
| `06-ondo.ts`                 | Ondo stock tokens on NEAR                                                              |
| `07-jupiter.ts`              | Jupiter price and swap quote                                                           |
| `08-chain-signatures.ts`     | derive a Solana address, real Ed25519 sign request on testnet                          |
| `09-sponsors.ts`             | Rhea, OutLayer price oracle, NEAR AI Cloud                                             |
| `10` (manual)                | Privy NEAR wallet in a browser: headless signing (Wisnu)                               |
| `11` (contract)              | NEP-245 with near-sdk-contract-tools (Ghoza)                                           |
| `15-robinhood.ts`            | Robinhood Chain: genuine tokens, issuer controls, swaps, Intents funding               |
| `16-chain-signatures-evm.ts` | NEAR MPC signs a Robinhood Chain (EVM) swap; signer recovered                          |
| `18-robinhood-stocks.ts`     | every genuine Robinhood stock token, liquidity, $5 buy routes                          |
| `19-relay-wire.ts`           | NEP-366 delegate as base64 borsh: encode, decode, verify, relay                        |
| `20-api-relay-live.ts`       | `/api/onboard` and `/api/relay` in-process against testnet                             |

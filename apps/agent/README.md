# apps/agent

**Owners:** Kiel (@riorblade); `src/chainsig.ts` by Ghoza (@ghozzza). Spec: [SPEC.md §7](../../SPEC.md). Not
scaffolded yet.

The stock agent. It keeps the warehouse stocked with real xStocks on Solana, at an address derived from a NEAR account
through Chain Signatures (no private key exists for it).

## Loop

1. Read demand from the api (stock on hand, recent sales).
2. Quote USDC → xStock on a Solana aggregator; refuse prices more than 5 % above or 20 % below the stock's spot.
3. Ask the MPC signer to sign the swap, send it, wait until finalized.
4. Report the transaction to the api, which checks it on Solana itself before booking a single unit.

## Rules

- Limits in code: $50 per swap, $500 per day. One swap at a time, recorded in a state file with a run lock, so a crash
  never buys twice.
- The agent's own numbers count for nothing: the api reads the chain.
- xStocks use Token-2022 scaled amounts (`scaledUiConfig.multiplier` in Jupiter's answer): convert raw balances with
  the current multiplier before comparing with shares.
- Keys only in `.env`.

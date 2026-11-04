# Spike findings

What we ran, what we saw, what it means. Newest decisions at the top; raw output in `results/`.

## Decisions so far

| Question                                                   | Answer from spikes                              | Spike |
| ---------------------------------------------------------- | ----------------------------------------------- | ----- |
| Is NEAR fast enough for on-chain purchases during a party? | Yes: blocks ~0.64 s, final in ~1.9 s on mainnet | 01    |

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

# NYXERON

A nightclub game on NEAR where every drink on the menu is a real stock. A host opens a party, guests buy drinks, and
each drink holds 0.001 of a real share (Tesla, NVIDIA, S&P 500, …) that the guest owns afterwards. Players sign in
with Google or email, see a balance in dollars, and pay from their own NEAR account with no seed phrase, no wallet
pop-up and no gas.

Built at NEAR HACKATHON (1–14 Nov 2026).

<!-- TODO(#39): tracks, open decision D1 in SPEC §12 (proposed: `games`, `defi`, `open`). -->

**Live demo: https://nyxeron.xyz** (NEAR testnet). Repo: https://github.com/riorblade/nyxeron-near

<!-- TODO(#40): X post link and demo video. -->

## The problem

Owning a stock takes a brokerage account, and owning one on chain takes a wallet, a seed phrase, gas and a bridge.
Neither feels like play. NYXERON hides all of that behind a game: a player taps "buy" on a drink and ends up holding a
piece of a real share, in their own account, without learning what a blockchain is.

## Try it

Open https://nyxeron.xyz. Every step says what to do and what you should see. Steps 1–4 need no account.

| #   | Do                                                                                                        | See                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Tap **Play · no sign-in**, then **Play** on the title screen                                              | Practice mode: your 3D club (The Basement) and a menu of real stocks at live market prices                         |
| 2   | In the dock, open **Menu** and move a drink's price slider; try **DJ**; then **Open club** (bottom right) | The night starts: guests walk in and buy at the bar, with "+$0.84" floating over them                              |
| 3   | During the night, try **5×** or **20×** and **Happy hour**, then **Skip**                                 | The night report: margin, reputation, goals, "Why it went this way" and a receipt of what sold                     |
| 4   | Tap **Next night**, then **Week** in the dock                                                             | Seven nights simulated at once, with each night's guests, drinks, margin and reputation                            |
| 5   | Go back to the start, tap **City · sign in**, pick **Go out as a guest**, sign in with Google or email    | A NEAR account is made for you (shown in the bar, linked to the explorer), balance in dollars                      |
| 6   | Tap **Get test dollars**                                                                                  | "$3.00 on the way." and the balance goes to $3.00: test USDC in your own account (testnet only, once a day)        |
| 7   | Open **House Party** (_always on_, top of the list) and tap **×3** next to TSLA                           | No pop-up and no gas: "3 × TSLA $1.71 · paid" with a receipt link to the transaction on the NEAR explorer          |
| 8   | When the party ends (a House Party lasts 10 minutes), look at **Collect shares** in your portfolio        | The party's delivery status, then a delivery receipt; the units show under **Shares you hold**                     |
| 9   | Tap **Add money**, keep USDC on Base, type any address for the refund field, tap **Get a quote**          | "You send 10.0 USDC on Base. You get about $9.99 here": a live NEAR Intents quote; on testnet nothing is sent      |
| 10  | Tap **Switch to CEO**, then **Host a party**: give it a name and a length, tap **Open it**                | Your own party page; as the host you set each drink's price between wholesale and 3× wholesale and keep the margin |
| 11  | Open https://nyxeron.xyz/proof                                                                            | The contract, USDC and price key on NEAR, the registered stocks, and the pinned Robinhood token addresses          |

<!-- TODO(#39): per-party steps on /proof once the public read lands (#83); until then they show on the party page. -->

## How it uses NEAR

| Part              | NEAR feature                                                                                                          | Where                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Sign-in           | Google or email sign-in gives each player a NEAR implicit account through Privy's embedded NEAR wallet                | `apps/web/src/auth`                                         |
| No gas            | NEP-366 meta transactions: the player signs a delegate action, our relayer pays gas and the 1 yocto deposit           | `apps/web/src/near`, `services/api/src/relay.ts`            |
| Paying for drinks | USDC `ft_transfer_call` to our contract with a server-signed price quote; the contract checks it and splits the money | `contracts/nyxeron`, `services/api/src/parties.ts`          |
| Owning shares     | Stock units as NEP-245 multi tokens on our contract, 1 unit = 0.001 share                                             | `contracts/nyxeron`                                         |
| Real stocks       | Robinhood stock tokens on Robinhood Chain, bought by an address a NEAR account controls through Chain Signatures      | `services/api/src/chainsig.ts`                              |
| Money in and out  | NEAR Intents (1Click) top-up and cash-out from any chain, straight to and from the player's account                   | `services/api/src/intents.ts`, `apps/web/src/city/money.ts` |

The server can never move a player's dollars: only the player signs a payment. The relayer accepts one action to our
contract or to USDC, with at most 1 yocto attached, and nothing else.

## How the money moves

```
 Player (Privy NEAR account)     NEAR                                     Robinhood Chain (4663)
 Buy a drink (signed, no UI) ─► relayer ─► USDC ft_transfer_call
                                          └─► nyxeron contract ─► host's margin to the host
                                                               └─► wholesale to the treasury
 Party ends                      treasury ─► USDG to the warehouse address (Chain Signatures, no private key)
                                 api ─► swap USDG → stock token, verify the balance
                                 └─► mint_warehouse + settle ─► NEP-245 units in each guest's account
```

Prices: wholesale = token price × 0.001 × 1.01 (swap fee buffer), rounded up to the cent. A host may charge up to 3×
wholesale; the contract refuses anything above it and refunds the payment in full.

## On chain

| Network | What                    | Account                                                                    |
| ------- | ----------------------- | -------------------------------------------------------------------------- |
| testnet | Game contract (NEP-245) | [`nyxeron.testnet`](https://testnet.nearblocks.io/address/nyxeron.testnet) |
| testnet | Dollars (Circle USDC)   | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`         |

<!-- TODO(#39): mainnet proof table from Ghoza + Kiel (one top-up, one drink, one warehouse swap, one settle, one
cash-out; SPEC §10), with explorer links. -->

Known risk: Robinhood's token issuer can block, pause or burn its tokens, and the Robinhood Chain sequencer can filter
transactions. Purchases are kept small and the warehouse can be paused.

## Run it locally

The hosted demo runs the web on Vercel and the api in Docker with SQLite (see
[services/api/README.md](services/api/README.md)). To run it yourself:

Node 24 (`.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
cp services/api/.env.example services/api/.env   # fill in Privy, relayer and quote key (comments explain each)
cp apps/web/.env.example apps/web/.env           # the same Privy app id
pnpm dev:api                                     # api on :8788
pnpm --filter @nyxeron/web dev                   # web on :5173, proxies /api to the api
```

Practice mode works without any `.env`. Checks: `pnpm lint` (typecheck, ESLint, Prettier), `pnpm test` (Vitest),
`pnpm test:contract` (Rust contract tests).

## Repo map

| Folder                                   | What                                                              | Owner |
| ---------------------------------------- | ----------------------------------------------------------------- | ----- |
| [`apps/web`](apps/web)                   | Game client (Practice, City, portfolio, /proof) and back office   | Wisnu |
| [`services/api`](services/api)           | Game server: accounts, parties, price quotes, relayer, settlement | Kiel  |
| [`packages/game`](packages/game)         | The game as pure TS: stocks, economy numbers, party simulation    | Kiel  |
| [`contracts/nyxeron`](contracts/nyxeron) | NEAR contract: drink payments and stock units as NEP-245          | Ghoza |
| [`spikes`](spikes)                       | Hands-on tests behind each design choice, results in FINDINGS.md  | all   |

Plan: [plan.md](plan.md) · design: [SPEC.md](SPEC.md) · spike results: [spikes/FINDINGS.md](spikes/FINDINGS.md) ·
hackathon rules: [HACKATHON.md](HACKATHON.md) · how we work: [CONTRIBUTING.md](CONTRIBUTING.md).

## Built with

React 19, Vite, Tailwind CSS, Hono, near-api-js, Privy, Vitest; the contract in Rust with near-sdk.

The 3D club and the game screen layout are adapted from nightclub-game prototypes our team built before the
hackathon. Everything that touches NEAR was built during the hackathon: the contract, sign-in with a NEAR account, the
gasless relayer, signed drink quotes, Chain Signatures for the warehouse and the settlement. We used AI coding tools
(Claude Code).

<!-- TODO(#39): confirm with the team before submission:
  - other projects by team members at this hackathon (Q-015).
  - LICENSE file (Q-014). -->

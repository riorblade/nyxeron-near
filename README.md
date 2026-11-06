# NYXERON

A nightclub game on NEAR where every drink on the menu is a real stock. A host opens a party, guests buy drinks, and
each drink holds 0.001 of a real share (Tesla, NVIDIA, S&P 500, …) that the guest owns afterwards. Players sign in
with Google or email, see a balance in dollars, and pay from their own NEAR account with no seed phrase, no wallet
pop-up and no gas.

Built at NEAR HACKATHON (1–14 Nov 2026). Tracks: `games`, `defi`, `open`.

<!-- TODO(#39): demo URL, X post link, and video once they exist (#40). -->

## The problem

Owning a stock takes a brokerage account, and owning one on chain takes a wallet, a seed phrase, gas and a bridge.
Neither feels like play. NYXERON hides all of that behind a game: a player taps "buy" on a drink and ends up holding a
piece of a real share, in their own account, without learning what a blockchain is.

## Try it

<!-- TODO(#39): hosted demo URL. Until then, run it locally (below). -->

Every step says what to do and what you should see.

| #   | Do                                                                                     | See                                                                                                       |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Open the demo and tap **Play · no sign-in**                                            | Practice mode: your club, a menu of stocks at live market prices, no account needed                       |
| 2   | Move a drink's price slider, then tap **Open the doors · 22:00**                       | Guests arrive; each one buys or passes ("too steep") in the live feed, with sales and crowd energy        |
| 3   | During the night, change the DJ or start a happy hour; tap **Skip to closing** (or 4×) | The night report: sales, your margin, and how many shares the guests went home with                       |
| 4   | Tap **Fast-forward a week with this menu**                                             | Seven nights simulated in about a second, with each night's guests, drinks, margin and reputation         |
| 5   | Go back and tap **City · sign in**, sign in with Google                                | A NEAR account is made for you (an implicit account, shown in the bar), balance in dollars                |
| 6   | **Host a party**: give it a name and a length, tap **Open it**                         | Your party page with its menu; as the host you can set each price between wholesale and 3× wholesale      |
| 7   | Open a party and buy a drink                                                           | No pop-up and no gas: the payment is signed in the background, sent by our relayer, and lands on chain    |
| 8   | **Your portfolio**                                                                     | Stock units you hold (NEP-245 on our contract) and shares still owed to you from parties                  |
| 9   | Open **/proof**                                                                        | The contract, USDC and price key on NEAR, the registered stocks, and the pinned Robinhood token addresses |

<!-- TODO(#39) before submission, check each against what is merged and live:
  - step 7 needs test dollars in the account: "Get test dollars" (SPEC §10) is not built yet.
  - Collect shares after a party (settle) and the per-party proof on /proof wait on the settlement job.
  - Add money / Cash out through NEAR Intents (1Click) are not built yet; the UI says "Not open yet".
  - Run every step from a clean browser (incognito, no extensions) and on a phone. -->

## How it uses NEAR

| Part              | NEAR feature                                                                                                          | Where                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Sign-in           | Privy social login creates a NEAR implicit account the player owns (key split 2-of-2, held in an enclave)             | `apps/web/src/auth`                                |
| No gas            | NEP-366 meta transactions: the player signs a delegate action, our relayer pays gas and the 1 yocto deposit           | `apps/web/src/near`, `services/api/src/relay.ts`   |
| Paying for drinks | USDC `ft_transfer_call` to our contract with a server-signed price quote; the contract checks it and splits the money | `contracts/nyxeron`, `services/api/src/parties.ts` |
| Owning shares     | Stock units as NEP-245 multi tokens on our contract, 1 unit = 0.001 share                                             | `contracts/nyxeron`                                |
| Real stocks       | Robinhood stock tokens on Robinhood Chain, bought by an address a NEAR account controls through Chain Signatures      | `services/api` (in progress)                       |
| Money in and out  | NEAR Intents (1Click) top-up and cash-out from any chain, straight to and from the player's account                   | planned                                            |

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

React 19, Vite, Tailwind CSS, Hono, near-api-js, Privy, Vitest; the contract in Rust with near-sdk. All code was
written during the hackathon, partly with AI coding tools (Claude Code).

<!-- TODO(#39): confirm with the team before submission:
  - prior work disclosure (Q-002/Q-005): is there an earlier NYXERON build (e.g. on Roblox) to name as baseline?
  - other projects by team members at this hackathon (Q-015).
  - LICENSE file (Q-014). -->

# NYXERON

A nightclub game on NEAR where every drink on the menu is a real stock. A host opens a party, guests buy drinks, and
each drink holds 0.001 of a real share (Tesla, NVIDIA, S&P 500, …) that the guest owns afterwards. Players sign in
with Google or email, see a balance in dollars, and pay from their own NEAR account with no seed phrase, no wallet
pop-up and no gas.

Built at NEAR HACKATHON (1–14 Nov 2026).

**Tracks: `games` + `defi` + `open`.**

- **Games With Real Economies (`games`)**, the lead: the game loop comes first (price a menu, read the crowd, keep
  the margin). The economy is real (every drink is a slice of a real share), and players never notice the chain:
  Google sign-in, no gas, no pop-up, shares as NEP-245 tokens.
- **Unstoppable DeFi (`defi`)**: our own contract takes each USDC payment and splits it between the host's margin and
  the wholesale cost, money comes in and goes out from any chain through NEAR Intents (1Click), and the stock tokens
  are bought by an address a NEAR account controls through Chain Signatures.
- **Open Innovation (`open`)**: a full product on NEAR: NEP-366 meta-transactions, NEP-245 units, NEAR accounts made
  through Privy, our own contract and api.

**Live demo: https://nyxeron.xyz** (landing) → **Launch app** → https://app.nyxeron.xyz (NEAR testnet). Docs: https://docs.nyxeron.xyz · Repo: https://github.com/riorblade/nyxeron-near

<!-- TODO(#40): X post link and demo video. -->

## The problem

Owning a stock takes a brokerage account, and owning one on chain takes a wallet, a seed phrase, gas and a bridge.
Neither feels like play. NYXERON hides all of that behind a game: a player taps "buy" on a drink and ends up holding a
piece of a real share, in their own account, without learning what a blockchain is.

## Try it

Open https://nyxeron.xyz and tap **Launch app** (or go straight to https://app.nyxeron.xyz). Every step says what to do and what you should see. Steps 1–4 need no account; step 8 is optional.

| #   | Do                                                                                                                                           | See                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tap **Practice**, then **Play** on the title screen                                                                                          | Practice mode: your 3D club (The Basement) and a menu of real stocks at live market prices                                                                                                          |
| 2   | In the dock, open **Menu** and move a drink's price slider; try **DJ**; open **Staff** and hire bartenders and security; then **Open club**  | The night starts: guests walk in and buy at the bar, with "+$0.84" floating over them                                                                                                               |
| 3   | During the night, try **5×** or **20×** and **Happy hour**, then **Skip**                                                                    | The night report: margin, staff wages, profit, reputation, goals, "Why it went this way" and a receipt of what sold                                                                                 |
| 4   | Tap **Next night**, then **Week** in the dock                                                                                                | Seven nights simulated at once, with each night's guests, drinks, margin and reputation                                                                                                             |
| 5   | Go back to the start, tap **City · sign in**, pick **Go out as a guest**, sign in with Google or email                                       | A NEAR account is made for you (shown in the bar, linked to the explorer), balance in dollars                                                                                                       |
| 6   | Tap **Get test dollars**                                                                                                                     | "$3.00 on the way." and the balance goes to $3.00: test USDC in your own account (testnet only, once a day)                                                                                         |
| 7   | Open **House Party** (_always on_, top of the list) and tap **×3** next to TSLA                                                              | No pop-up and no gas: "3 × TSLA $… · paid" with a receipt link to the transaction on the NEAR explorer                                                                                              |
| 8   | On the party page tap **Walk in the club**; walk with WASD or the arrows (a touch stick on a phone), try a dance, then **← Back to the bar** | Your own avatar in the 3D club (the superclub) among the crowd, with Behind / Eyes / Drone / Show cameras and dances                                                                                |
| 9   | When the party ends (a House Party lasts 10 minutes), look at **Collect shares** in your portfolio                                           | "Delivering your shares…", then "Delivered to your portfolio." and a delivery receipt; "TSLA 0.003 share" under **Shares you hold**                                                                 |
| 10  | Tap **Add money**, keep USDC on Base, type any address for the refund field, tap **Get a quote**                                             | "You send 10.0 USDC on Base. You get about $9.99… here": a live NEAR Intents quote; on testnet nothing is sent                                                                                      |
| 11  | Tap **Switch to CEO**, then **Host a party**: give it a name and a length, tap **Open it**                                                   | Your party page with **Your prices** (move a slider, **Save prices**: wholesale up to 3×, you keep the margin) and **Work the crowd**: Happy hour, Anthem, MC hype, Pyro                            |
| 12  | Open https://app.nyxeron.xyz/proof and tap a party under **Party by party** (one where drinks were bought)                                   | The contract, USDC and price key on NEAR; units against the shares behind them (testnet: synthetic stand-ins on Robinhood Chain testnet); each party's release → swap → mint → settle with tx links |

## How it uses NEAR

| Part              | NEAR feature                                                                                                                                                               | Where                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Sign-in           | Google or email sign-in gives each player a NEAR implicit account through Privy's embedded NEAR wallet                                                                     | `apps/web/src/auth`                                         |
| No gas            | NEP-366 meta transactions: the player signs a delegate action, our relayer pays gas and the 1 yocto deposit                                                                | `apps/web/src/near`, `services/api/src/relay.ts`            |
| Paying for drinks | USDC `ft_transfer_call` to our contract with a server-signed price quote; the contract checks it and splits the money                                                      | `contracts/nyxeron`, `services/api/src/parties.ts`          |
| Owning shares     | Stock units as NEP-245 multi tokens on our contract, 1 unit = 0.001 share                                                                                                  | `contracts/nyxeron`                                         |
| Real stocks       | Robinhood stock tokens on Robinhood Chain, bought by an address a NEAR account controls through Chain Signatures (testnet: synthetic stand-ins on Robinhood Chain testnet) | `services/api/src/chainsig.ts`, `swap.ts`                   |
| Money in and out  | NEAR Intents (1Click) top-up and cash-out from any chain, straight to and from the player's account                                                                        | `services/api/src/intents.ts`, `apps/web/src/city/money.ts` |

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

Status: on testnet (the live demo) the whole chain runs for real. After a party the warehouse, a Robinhood Chain
address controlled by the NEAR account `nyx-warehouse.testnet` through Chain Signatures (`v1.signer-prod.testnet`),
buys **synthetic stock tokens** (`sTSLA`, `sCRCL`, …) for test dollars on **Robinhood Chain testnet** (chain 46630),
because Robinhood's real stock tokens exist on mainnet only. That swap's hash is the mint's proof on NEAR. Example, party
`dfec4462-20` (2 × CRCL): [swap on Robinhood Chain testnet](https://explorer.testnet.chain.robinhood.com/tx/0x09056919ca56003a5eb33eb29ddddce30ef2c17ef1466c0651f266d2c31f2d76), then mint and settle on NEAR testnet. The same code
buys the real tokens through KyberSwap on mainnet (`services/api/src/swap.ts`, `contracts/hood-testnet` for the
stand-ins).

Prices: wholesale = token price × 0.001 × 1.01 (swap fee buffer), rounded up to the cent. A host may charge up to 3×
wholesale; the contract refuses anything above it and refunds the payment in full.

## The contract

`contracts/nyxeron` (Rust, near-sdk 5) takes the drink payments and holds the stock units as NEP-245 multi tokens.
Full interface: [`contracts/nyxeron/README.md`](contracts/nyxeron/README.md). Security review:
[`contracts/nyxeron/AUDIT.md`](contracts/nyxeron/AUDIT.md).

What it enforces on its own:

- **A payment either goes through whole or comes back whole.** Every check failing (bad signature, expired quote,
  wrong amount, unknown stock, paused, …) refunds the full amount with a `refund` event that says why.
- **Prices are bounded.** A quote must be signed by the api's quote key, name this contract, be used once and not be
  expired, and its price must be between the wholesale and 3 × the wholesale. The buyer must be the one paying.
- **The host gets the margin at once.** The margin is sent to the party's host with the payment (if that transfer
  fails, it waits for the host's `claim_margin`). The host is fixed by the party's first purchase, so a later quote
  can't send that party's margin elsewhere.
- **A guest gets what they paid for, never more.** Each purchase records the units the guest is owed. `settle` moves
  units from the warehouse to the party's guests, all or nothing, each at most what they are owed, and each `op_id`
  runs once. Each `mint_warehouse` proof (the share purchase's tx hash) backs one mint only.
- **It can stop.** `set_paused` refunds new payments and stops release, mint and settle; holders can still move their
  units and hosts can still claim margin.

What it trusts the api for: the contract can't read Robinhood Chain, so the owner key decides that a mint is backed.
That key is a function-call key limited to this contract's owner methods. `/proof` compares the units in
circulation (`mt_supply`) with the shares the warehouse holds: on testnet its synthetic stand-ins on Robinhood Chain
testnet, labelled "synthetic (testnet)".

Tests: `cd contracts/nyxeron && cargo test` runs 78 unit tests and 10 sandbox tests against a real NEP-141 token
(two more are gas probes, run with `--ignored`). CI also runs `cargo fmt --check` and `cargo clippy`.

## On chain

| Network | What                                 | Account                                                                                                                      |
| ------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| testnet | Game contract (NEP-245)              | [`nyxeron.testnet`](https://testnet.nearblocks.io/address/nyxeron.testnet)                                                   |
| testnet | Dollars (Circle USDC)                | [`3e2210e1…afcb8af`](https://testnet.nearblocks.io/address/3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af) |
| testnet | Owner / api (settles parties)        | [`nyxeron-api.testnet`](https://testnet.nearblocks.io/address/nyxeron-api.testnet)                                           |
| testnet | Relayer (pays gas, NEP-366)          | [`nyx-relayer-mw1s6vvb.testnet`](https://testnet.nearblocks.io/address/nyx-relayer-mw1s6vvb.testnet)                         |
| testnet | Warehouse account (Chain Signatures) | [`nyx-warehouse.testnet`](https://testnet.nearblocks.io/address/nyx-warehouse.testnet)                                       |
| testnet | MPC signer                           | [`v1.signer-prod.testnet`](https://testnet.nearblocks.io/address/v1.signer-prod.testnet)                                     |

| Network                 | What                                                                               | Address                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Robinhood Chain testnet | Warehouse (controlled by `nyx-warehouse.testnet` via Chain Signatures)             | [`0xa7175f62…d74323`](https://explorer.testnet.chain.robinhood.com/address/0xa7175f62675ec1B780577944E545047df0d74323)   |
| Robinhood Chain testnet | Market (synthetic stocks for test dollars)                                         | [`0xa7dcd7d0…dd0c26e1`](https://explorer.testnet.chain.robinhood.com/address/0xa7dcd7d0494d046dfb1a99d1587574d9dd0c26e1) |
| Robinhood Chain testnet | Test dollars (tUSDG)                                                               | [`0x7bcdb2de…3db2ac9`](https://explorer.testnet.chain.robinhood.com/address/0x7bcdb2de027efb565b01d42a28fb95b9a3db2ac9)  |
| Robinhood Chain testnet | sTSLA, one of the ten synthetic stocks (all in `services/api/src/hood-testnet.ts`) | [`0x24eab92d…eaa9b2c`](https://explorer.testnet.chain.robinhood.com/address/0x24eab92d2196526402117e9b5962af90feaa9b2c)  |

One party end to end on testnet (party `dfec4462-20`, 2 × CRCL):

| Step                                                 | Chain                   | Transaction                                                                                                                         |
| ---------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `release_wholesale`: the party's pot to the treasury | NEAR testnet            | [`CgpvscLd…`](https://testnet.nearblocks.io/txns/CgpvscLdKexkuwCC9oVXp19UpgmtoTMyKnyou8nQSLs9)                                      |
| Warehouse buys 0.002 sCRCL for 0.122312 tUSDG        | Robinhood Chain testnet | [`0x09056919…`](https://explorer.testnet.chain.robinhood.com/tx/0x09056919ca56003a5eb33eb29ddddce30ef2c17ef1466c0651f266d2c31f2d76) |
| `mint_warehouse`, with that swap's hash as the proof | NEAR testnet            | [`E7x9MBBS…`](https://testnet.nearblocks.io/txns/E7x9MBBScoNoEL8t9WLtjmU6Ko9j2pC6bQf2w1DoVYvs)                                      |
| `settle`: the units move to the guests               | NEAR testnet            | [`J8hCx249…`](https://testnet.nearblocks.io/txns/J8hCx249genMPmEbW5aAupXhzZxB5pWf4dNZEcNAfi8X)                                      |

A second party, the one in the demo video (party `dfec4462-25`, 3 × TSLA):

| Step                                                                            | Chain                   | Transaction                                                                                                                         |
| ------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `release_wholesale`                                                             | NEAR testnet            | [`Ee81fGfw…`](https://testnet.nearblocks.io/txns/Ee81fGfwefaDE3uBr2jtoEjUtVCGVULwapfNXbxuyyRT)                                      |
| Warehouse buys 0.003 sTSLA for 1.178922 tUSDG (signed through Chain Signatures) | Robinhood Chain testnet | [`0xe78270ba…`](https://explorer.testnet.chain.robinhood.com/tx/0xe78270ba1053fe919cd01a2724707acd72c5434c6b617fcfabf386d7b915e7aa) |
| `mint_warehouse`, with that swap's hash as the proof                            | NEAR testnet            | [`75vB3Ygj…`](https://testnet.nearblocks.io/txns/75vB3YgjNoUt2jw64KBpfNzkPp8VvnoYQR2XUKgesjSn)                                      |
| `settle`: 0.003 TSLA to the guest                                               | NEAR testnet            | [`8us4JGfo…`](https://testnet.nearblocks.io/txns/8us4JGfoMTZmyvtGG6nrQkyB7uuuHML7KDQ9Fe8BWERB)                                      |

A guest's drink payment, gasless: the player signs a NEP-366 delegate action, the relayer submits it, and USDC
`ft_transfer_call` pays the contract with the signed quote (3 × TSLA):
[`3jhukG2L…`](https://testnet.nearblocks.io/txns/3jhukG2LiiRSACLktNF4M8MFwidjTeJSmdEaR1NZA28u). Every party's steps, live: https://app.nyxeron.xyz/proof.

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
| [`apps/docs`](apps/docs)                 | The docs at docs.nyxeron.xyz (Next.js, Fumadocs, MDX)             | Wisnu |

Plan: [plan.md](plan.md) · design: [SPEC.md](SPEC.md) · spike results: [spikes/FINDINGS.md](spikes/FINDINGS.md) ·
hackathon rules: [HACKATHON.md](HACKATHON.md) · how we work: [CONTRIBUTING.md](CONTRIBUTING.md).

## Built with

React 19, Vite, Tailwind CSS, Hono, near-api-js, Privy, Vitest; the contract in Rust with near-sdk.

The 3D club and the game screen layout are adapted from nightclub-game prototypes our team built before the
hackathon. Everything that touches NEAR was built during the hackathon: the contract, sign-in with a NEAR account, the
gasless relayer, signed drink quotes, Chain Signatures for the warehouse and the settlement. We used AI coding tools
(Claude Code).

## License

MIT, see [LICENSE](LICENSE).

<!-- TODO(#39): confirm with the team before submission: other projects by team members at this hackathon (Q-015). -->

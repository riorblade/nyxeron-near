# apps/web

**Owner:** Wisnu (@AdityaWisnuu). Spec: [SPEC.md §8](../../SPEC.md). Vite + React + Tailwind.

The browser app: the game client and the back office (`/admin`, lazy-loaded, every check repeated on the server).

## Run

```sh
cp apps/web/.env.example apps/web/.env   # the Privy app id
pnpm dev:api                             # the api on :8788 (needs its own .env, see services/api)
pnpm --filter @nyxeron/web dev           # http://localhost:5173, /api is proxied to the api
```

## Screens so far

| Path              | What                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`               | Landing                                                                                                                                                |
| `/practice`       | Practice: club dashboard, live party, night report, fast-forward week. No login; career in localStorage                                                |
| `/city`           | Sign in (Privy) as CEO (host, prices) or guest (parties, portfolio); wallet, dollars, Get test dollars                                                 |
| `/city/party/:id` | Over the 3D club: menu, one-tap buy (quote → delegate → relay), host prices, Walk in the club (own avatar, cameras, dances); after it ends, settlement |
| `/proof`          | What is on chain: contract, USDC, registered stocks, pinned Robinhood token addresses                                                                  |
| `/admin`          | Back office, lazy-loaded: role, players, settlement problems with retry                                                                                |
| `/spike`          | Spike 10 test page (Privy NEAR wallet signing)                                                                                                         |

Add money / Cash out (`city/MoneyPanel.tsx`, `city/money.ts`) quote through the api's 1Click endpoints; on testnet every
quote is a dry run (nothing to send), on mainnet Add money shows the deposit address and Cash out signs the USDC transfer
here and relays it. Collect shares (in the
portfolio) reads `owed(chainParty)` from the contract and `GET /api/parties/:id/settlement` for each party this browser
bought at. Get test dollars shows only when `/api/config` has `testDollars` (testnet with `DEMO_MODE`).

`src/practice/` is the game screen, laid out like our course prototype: title → the day (venue carousel with a padlock
on rooms the reputation hasn't opened, menu and DJ windows) → the night (HUD over the club) → the night report.
`src/venue/` (Kiel) is the 3D club, ported from our earlier prototype: The Basement, one room that grows with the venue
level (L1 30 guests → L4 150). `<Venue level night />` only reads the `Night`; `legacy.ts` dresses it up as the state the
old scene draws. Assets live in `public/venue/` (sprites, textures, DJ loops). Both screens are adapted from our earlier
work: the judges' README must say so (HACKATHON Q-002).

Club music (`src/audio/`, Kiel) plays on every screen with a mute toggle bottom-left; on a phone the Practice dock sits
above it.

Practice gets the night's prices from `GET /api/quotes` and falls back to a labelled sample when the api is down.
Colors are placeholder tokens in `src/index.css` until the design tokens land.

`src/near/delegate.ts` builds the drink payment delegate and signs it with any `SignHash` (Privy's `signRawHash` in the
app); its test checks the result against the api's own relay checks.

## Plan

- React + Vite + Tailwind, TypeScript. Extend `../../tsconfig.base.json` (switch `module`/`moduleResolution` to
  `ESNext`/`Bundler` for Vite).
- Sign-in with Privy and its NEAR wallet (`@privy-io/react-auth/extended-chains`).
- API calls through a typed client: `hc<AppType>()` from `hono/client`, with `AppType` imported from `@nyxeron/api`.
  No hand-written request types.
- Game rules come from `@nyxeron/game`; the UI only shows state and sends player actions.
- Vite proxies `/api` to `http://localhost:8788` in development.
- UI text in English. Style: neon nightclub (Kiel ships the color tokens and base components).

## Screens

Landing, club dashboard, party, night report, City (venues, live parties), portfolio (units on NEAR), top-up,
`/proof`, back office (`/admin`: players, top-ups, sales, stock, audit).

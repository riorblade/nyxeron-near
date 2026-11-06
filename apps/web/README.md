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

| Path              | What                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `/`               | Landing                                                                                                 |
| `/practice`       | Practice: club dashboard, live party, night report, fast-forward week. No login; career in localStorage |
| `/city`           | Sign in (Privy), wallet + onboarding, dollar balance, live parties, host a party, portfolio             |
| `/city/party/:id` | The party menu, one-tap buy (quote → delegate → relay); the host also sets prices here                  |
| `/proof`          | What is on chain: contract, USDC, registered stocks, pinned Robinhood token addresses                   |
| `/admin`          | Back office, lazy-loaded: role, players                                                                 |
| `/spike`          | Spike 10 test page (Privy NEAR wallet signing)                                                          |

Add money / Cash out show their screens; the 1Click endpoints come with the api's `intents.ts`. Collect shares reads
`owed(party)`, which arrives with contract v2.

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

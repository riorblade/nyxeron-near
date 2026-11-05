# apps/web

**Owner:** Wisnu (@AdityaWisnuu). Spec: [SPEC.md §8](../../SPEC.md). Scaffolded with Vite + React; for now the only page is the
spike 10 test (Privy NEAR wallet signing, [#29](https://github.com/riorblade/nyxeron-near/issues/29)).

The browser app: the game client and the back office (`/admin`, lazy-loaded, every check repeated on the server).

## Run

```sh
cp apps/web/.env.example apps/web/.env   # the Privy app id
pnpm dev:api                             # the api on :8788 (needs its own .env, see services/api)
pnpm --filter @nyxeron/web dev           # http://localhost:5173, /api is proxied to the api
```

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

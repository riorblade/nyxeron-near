# apps/web

**Owner:** Wisnu (@AdityaWisnuu). Spec: [SPEC.md §8](../../SPEC.md). Not scaffolded yet: Wisnu sets it up.

The browser app: the game client and the back office (`/admin`, lazy-loaded, every check repeated on the server).

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

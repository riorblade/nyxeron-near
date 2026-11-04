# NYXERON

A multiplayer nightclub game on NEAR where every drink on the menu is a real stock. Players sign in with Google or
email and get a NEAR account, top up from any chain through NEAR Intents, and pay for drinks from their own account
with no gas and no wallet pop-ups. The shares are Robinhood stock tokens on Robinhood Chain, bought by an address a
NEAR account controls through Chain Signatures; guests own their units as NEP-245 tokens.

Built for NEAR HACKATHON. The judge-facing README (problem, "do X, see Y" steps, on-chain proof) replaces this one
before submission.

## Repo map

| Folder                                   | What                                                                 | Owner |
| ---------------------------------------- | -------------------------------------------------------------------- | ----- |
| [`services/api`](services/api)           | Game server: accounts, credits, parties, top-ups, settlement to NEAR | Kiel  |
| [`packages/game`](packages/game)         | The game as pure TS: stocks, economy numbers, party simulation       | Kiel  |
| [`contracts/nyxeron`](contracts/nyxeron) | NEAR contract: stock units as NEP-245                                | Ghoza |
| [`apps/web`](apps/web)                   | Game client and back office                                          | Wisnu |

Plan and tasks: [plan.md](plan.md) · design: [SPEC.md](SPEC.md) · hackathon rules: [HACKATHON.md](HACKATHON.md) ·
how we work: [CONTRIBUTING.md](CONTRIBUTING.md).

## Quick start

Node 24 (`.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm lint      # typecheck + ESLint + Prettier
pnpm test      # Vitest across every package
pnpm dev:api   # services/api on :8788 (needs services/api/.env)
```

NEAR agent skills for Claude Code: `npx skills experimental_install`.

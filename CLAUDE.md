# NYXERON · Claude Code rules

NEAR HACKATHON entry, deadline 2026-11-14 23:59 UTC. Built on NEAR from scratch.

- Read plan.md (tasks per person), SPEC.md (design) and HACKATHON.md (rules; re-read the live
  https://nearhackathon.com/HACKATHON.md before submitting).
- Lanes: Ghoza (@ghozzza) contracts/ + Chain Signatures; Kiel (@riorblade) services/, apps/agent, packages/game
  (game flow), deploy, visuals; Wisnu (@AdityaWisnuu) apps/web (game client + back office), UX, README for judges,
  demo, submission. Each folder's README says what belongs there.
- Team flow (CONTRIBUTING.md): GitHub issue first → your `dev-<name>` branch → small commits → PR with
  `Closes #<n>` → merge. Never commit to main directly.
- Use the NEAR skills in .claude/skills (near-smart-contracts, near-intents, near-api-js, near-kit, near-dapp,
  near-contract-audit, near-cli-rs, near-ai-cloud). Contract ids, endpoints, asset ids and SDK versions come from
  https://docs.near.org/llms.txt, https://docs.near-intents.org/llms.txt or 1Click `/v0/tokens`; never guess them.
- Testnet first. Keys only in env files that git ignores, never in the repo.
- Never without the team's explicit yes: make the repo public, force-push, deploy to mainnet, sign or spend,
  post on X, send the hackathon submission.
- Game simulation lives in packages/game: pure TS, deterministic, seeded RNG. The UI never mutates state directly.
- Anything that moves credits, units or access is settled in services/api, never trusted from the client.
- Smart contracts: Rust near-sdk in contracts/, sandbox tests (near-workspaces), reproducible builds
  (`cargo near build`), near-contract-audit before mainnet.
- Every rule or money change comes with a test. UI text in English.
- Commit messages: `type(scope): summary`.
- Setup: `npx skills experimental_install` restores the NEAR skills from skills-lock.json into .claude/skills.

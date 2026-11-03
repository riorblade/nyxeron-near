# contracts/nyxeron

**Owner:** Ghoza (@ghozzza). Spec: [SPEC.md §5](../../SPEC.md). Not scaffolded yet: Ghoza sets it up
(`cargo near new`).

The NEAR contract that holds stock units as NEP-245 multi tokens. The api's account is the only one that mints into
the warehouse (with a Solana swap as proof) and settles parties (warehouse → guests).

## Rules

- Rust, near-sdk 5.x, skill `near-smart-contracts`. Reproducible builds with `cargo near build`.
- Sandbox tests with near-workspaces; `cargo test` runs in CI.
- Idempotent by design: a Solana tx is minted once (`used_proofs`), a settle op runs once (`settled`).
- Audit with the `near-contract-audit` skill before mainnet. Mainnet deploys only with the team's yes.
- Lock the interface (methods, arguments, events) by 4 Nov and tell the team: the api and the web build against it.

# Working on NYXERON

Team rule: every change, however small, goes through an issue, your own branch and a pull request.

## The flow

1. **Issue first.** Find or open a GitHub issue for the change. Title like a commit: `feat(api): live stock prices`.
   Assign yourself. One issue = one pull request.
2. **Your branch.** Work only on your branch: `dev-kiel`, `dev-ghoza`, `dev-wisnu`. Before you start, bring it up to
   date with main:

   ```sh
   git switch dev-<name>
   git fetch origin
   git merge origin/main
   ```

3. **Small commits.** Commit each step on its own, `type(scope): summary`:
   - types: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `ci`, `style`
   - scopes: `api`, `game`, `web`, `admin`, `contracts`, `spikes`, `repo`
4. **Push and open a pull request** into `main`. Title in the same style; the body says `Closes #<issue>`, what
   changed, why, and how you tested it (the template asks).
5. **Green CI, then merge** with "Create a merge commit" (keeps the small commits). The folder's owner
   (`.github/CODEOWNERS`) reviews. Keep your `dev-<name>` branch; don't delete it after the merge.

## Never

- Commit to `main` directly, or force-push a shared branch.
- Commit secrets: keys live in `.env` files that git ignores; only `.env.example` is committed.
- Merge red CI.

## Done means

- `pnpm lint` and `pnpm test` pass (contracts: `cargo test` in `contracts/nyxeron`).
- Every rule or money change has a test.
- The folder README is still true.

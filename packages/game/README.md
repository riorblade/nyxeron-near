# packages/game

**Owner:** Kiel (@riorblade). Spec: [SPEC.md §3](../../SPEC.md).

The game itself, as pure TypeScript: the stock list, the numbers money is settled with, and the party simulation.
The browser runs it to show the party; the server runs the same code to decide what really happened. One copy, so
the screen and the balance never disagree.

## Rules

- Pure and deterministic: no DOM, no network, no `Date.now()` or `Math.random()` inside the rules. Time and a seeded
  RNG are passed in, so a party replays identically.
- State in, state out. The UI never edits game state by hand.
- Every tunable number lives here, named, in one place.
- Every rule has a Vitest test.

Import it as `@nyxeron/game`.

# packages/game

**Owner:** Kiel (@riorblade). Spec: [SPEC.md §4](../../SPEC.md).

The game itself, as pure TypeScript: the stock menu, the numbers money is settled with, and the party simulation. The
browser runs it to show the party; the server runs the same code to check what the screen showed. One copy, so the
screen and the balance never disagree.

## The game loop

You run a nightclub. Every drink on the menu is a real stock: a "Tesla" is 0.001 of a Tesla share. Guests buy what
looks good at a price they like; you set the prices, the music and the promos.

| Every                      | You do                                                   | You see                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **30 s** (a party is live) | Nudge a price, start a promo, switch the DJ              | Guests arrive and leave, the crowd's energy moves, orders come in with a reason ("bought TSLA: it's up 4 % today") or a pass ("TSLA at 2.8× is too steep") |
| **5 min** (one night)      | Read the night report, fix the menu for the next night   | Sales per stock, your margin, peak and average energy, best seller, reputation gained or lost. As a guest: the shares you collected                        |
| **Session**                | Climb venue levels, rent a bigger club, grow a portfolio | Reputation unlocks bigger rooms; a week of nights in fast-forward shows whether your strategy works                                                        |

### A night

- 300 game minutes (22:00 → 03:00), one tick per minute: **one tick per second live** (5 real minutes), or all at
  once in fast-forward.
- **Guests** arrive while the room isn't full; how many come depends on reputation. Each has a budget and leaves when
  it's spent, when the energy is dead, or at closing.
- **Energy** (0–100) drifts towards what the DJ's genre gives this crowd, rises when the room is nearly full, sags when
  it's empty, and jumps during a promo.
- **Ordering**: each minute a guest thinks about a drink with a chance that grows with energy. They pick a drink with a
  chance in proportion to its appeal: appeal falls as your price climbs from wholesale to 3× wholesale, and rises for a stock that is up
  today (FOMO). Appeal is also the chance they go through with it, so dear drinks sell less often, never not at all.
  A drink they can't afford is a pass.
- **Your levers**: price per drink (wholesale … 3× wholesale), one **happy hour** per night (20 minutes, prices −20 %,
  never below wholesale, energy boost), and the **DJ** (genre).
- **Money**: every price is in micro-USDC. Each sale splits into wholesale (buys the real share) and your margin.

### After the night

- **Reputation** (0–100) moves with the night's average energy and how many guests got a drink.
- **Venue level** follows reputation: more room, more guests.

### Practice and City

The same simulation. In **Practice** the guests are simulated and spend play money. In **City** the simulated crowd
sets the mood, but only real players buy, with real USDC, through the api.

## Rules

- Pure and deterministic: no DOM, no network, no `Date.now()` or `Math.random()` inside the rules. The seed and the
  market prices are inputs, so a night replays identically.
- State in, state out. The UI never edits game state by hand.
- Every tunable number lives in [`src/rules.ts`](src/rules.ts), named and commented.
- Every rule has a Vitest test.

Import it as `@nyxeron/game`.

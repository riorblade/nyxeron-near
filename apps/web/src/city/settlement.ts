// Where a party's shares are after it ends (GET /api/parties/:id/settlement, services/api settlement.ts), in words a
// guest reads. The api runs the steps on its own; the web only reports them.
import type { InferResponseType } from 'hono/client'
import type { Account } from '../auth/useAccount.ts'

export type Settlement = InferResponseType<Account['api']['parties'][':id']['settlement']['$get'], 200>
export type Tone = 'muted' | 'ink' | 'up' | 'down'

const NOTES: Record<Settlement['status'], { text: string; tone: Tone }> = {
  live: { text: 'The party is on. Shares arrive after it ends.', tone: 'muted' },
  waiting: { text: 'Party over. Your shares are on their way.', tone: 'ink' },
  pending: { text: 'Delivering your shares…', tone: 'ink' },
  done: { text: 'Delivered to your portfolio.', tone: 'up' },
  failed: { text: 'Delivery is delayed. The shares are still owed to you on chain; we are on it.', tone: 'down' },
  off: { text: 'Shares are delivered when the party settles.', tone: 'muted' },
}

export const settlementNote = (status: Settlement['status']) => NOTES[status]

/** The tx that put the units in guests' accounts (the last settle batch that landed), for a receipt link. */
export function settleHash(s: Settlement): string | undefined {
  return s.ops.filter((o) => o.kind === 'settle' && o.status === 'done' && o.hash).at(-1)?.hash
}

const STEP: Record<Settlement['ops'][number]['kind'], string> = {
  release: 'Party money released for the shares',
  mint: 'Shares bought and units minted',
  settle: 'Units delivered to guests',
}

/** One line per step for /proof. */
export function stepLabel(op: Settlement['ops'][number], ticker: (id: string) => string): string {
  const what = op.kind === 'mint' && op.token ? `${STEP.mint} · ${ticker(op.token)}` : STEP[op.kind]
  return op.units ? `${what} · ${op.units} units` : what
}

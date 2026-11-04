// What a player holds and is owed, read straight from the contract. Pure helpers so the numbers are tested.
import { SHARES_PER_UNIT } from '@nyxeron/game'

// owed(party) on the contract (#22); qty may come as a number or a U128 string.
export type Owed = { account_id: string; token: string; qty: number | string }

/** NEP-245 balances come back as decimal strings, one per token id, in the order asked. */
export function unitsByToken(ids: string[], balances: string[] | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  ids.forEach((id, i) => {
    const n = Number(balances?.[i] ?? 0)
    if (n > 0) out[id] = n
  })
  return out
}

/** The units still owed to one player across parties: { party → { token → units } }. */
export function owedTo(account: string, byParty: Record<number, Owed[] | undefined>) {
  const out: Record<number, Record<string, number>> = {}
  for (const [party, rows] of Object.entries(byParty)) {
    for (const r of rows ?? []) {
      const qty = Number(r.qty)
      if (r.account_id !== account || !(qty > 0)) continue
      const p = (out[Number(party)] ??= {})
      p[r.token] = (p[r.token] ?? 0) + qty
    }
  }
  return out
}

/** Units → shares, as a player reads them ("0.003"). */
export const shares = (units: number) => (units * SHARES_PER_UNIT).toFixed(3)

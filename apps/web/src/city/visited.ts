// Parties this browser bought drinks at, so the portfolio knows where to look for shares owed. The contract is the
// truth (owed(party)); this list only says which parties to ask about.
const KEY = 'nyxeron.parties.v1'

export function visitedParties(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is number => Number.isInteger(x)) : []
  } catch {
    return []
  }
}

export function rememberParty(id: number) {
  try {
    const ids = visitedParties()
    if (!ids.includes(id)) localStorage.setItem(KEY, JSON.stringify([id, ...ids].slice(0, 50)))
  } catch {
    // Storage unavailable: the portfolio just won't list this party's owed shares.
  }
}

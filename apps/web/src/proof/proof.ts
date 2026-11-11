// What /proof shows from GET /api/proof and /api/proof/parties/:chainParty (services/api proof.ts), in words.
import type { InferResponseType } from 'hono/client'
import { api } from '../api.ts'

/** GET /api/proof, as its README row says (the route's cached body is typed `unknown`, so it is spelled out here). */
export type ProofView = {
  network: string
  contractId: string
  demo: boolean
  warehouse: string | null
  tokens: {
    token: string
    ticker: string
    address: string
    units: string | null
    sharesOwed: string | null
    sharesHeld: string | null
    backed: boolean | null
  }[]
  recent: { chainParty: string; title: string; endsAt: number; status: string }[]
  at: number
}
export type PartySteps = InferResponseType<(typeof api.proof.parties)[':chainParty']['$get'], 200>

/** A mint's proof, as a reader can take it: a simulated purchase on testnet, else the Robinhood Chain swap(s). */
export function proofText(proof: string | null | undefined): string | undefined {
  if (!proof) return undefined
  if (proof.startsWith('demo:')) return 'simulated purchase (testnet)'
  const [hash, more] = proof.split('+')
  const swaps = more ? ` and ${more} more swap${more === '1' ? '' : 's'}` : ''
  return `Robinhood Chain swap ${hash!.slice(0, 10)}…${hash!.slice(-6)}${swaps}`
}

/** Whether the warehouse holds what the units stand for: shown on mainnet only, where both sides are read. */
export function backedText(t: ProofView['tokens'][number]): { text: string; ok: boolean } | undefined {
  if (t.backed === null) return undefined
  return t.backed ? { text: 'backed', ok: true } : { text: 'short', ok: false }
}

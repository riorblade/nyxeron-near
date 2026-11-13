// What /proof shows from GET /api/proof and /api/proof/parties/:chainParty (services/api proof.ts), in words.
import type { InferResponseType } from 'hono/client'
import { api } from '../api.ts'

/** GET /api/proof, as its README row says (the route's cached body is typed `unknown`, so it is spelled out here). */
export type ProofView = {
  network: string
  contractId: string
  demo: boolean
  warehouse: string | null
  // Where the shares live: Robinhood Chain (4663), or its testnet (46630) with synthetic stocks.
  hood: Hood & { tokens: { token: string; ticker: string; address: string }[] }
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
export type Hood = { chainId: number; explorer: string; synthetic: boolean }
export type PartySteps = InferResponseType<(typeof api.proof.parties)[':chainParty']['$get'], 200>

/** A mint's proof, as a reader can take it: a simulated purchase, or the Robinhood Chain swap(s) (synthetic stock on its
 * testnet). */
export function proofText(proof: string | null | undefined, hood?: Pick<Hood, 'synthetic'>): string | undefined {
  if (!proof) return undefined
  if (proof.startsWith('demo:')) return 'simulated purchase (testnet)'
  const [hash, more] = proof.split('+')
  const swaps = more ? ` and ${more} more swap${more === '1' ? '' : 's'}` : ''
  const where = hood?.synthetic ? 'Robinhood Chain testnet swap (synthetic stock)' : 'Robinhood Chain swap'
  return `${where} ${hash!.slice(0, 10)}…${hash!.slice(-6)}${swaps}`
}

/** The first swap of a mint's proof on its explorer; none for a simulated purchase. */
export function proofLink(proof: string | null | undefined, hood: Pick<Hood, 'explorer'>): string | undefined {
  const hash = proof?.split('+')[0]
  return hash && /^0x[0-9a-fA-F]{64}$/.test(hash) ? `${hood.explorer}/tx/${hash}` : undefined
}

/** Whether the warehouse holds what the units stand for: shown on mainnet only, where both sides are read. */
export function backedText(t: ProofView['tokens'][number]): { text: string; ok: boolean } | undefined {
  if (t.backed === null) return undefined
  return t.backed ? { text: 'backed', ok: true } : { text: 'short', ok: false }
}

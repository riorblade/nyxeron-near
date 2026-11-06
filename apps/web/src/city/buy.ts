// Buying a drink at a City party: the api signs a quote and hands back the exact payment; the player's wallet signs it
// as a delegate (no popup, spike 10) and the relayer sends it. The UI shows the drink as soon as the relay answers.
import type { Provider } from 'near-api-js'
import { type Call, delegateFor, type SignHash, signDelegate } from '../near/delegate.ts'
import { chainFailure, PlayerError } from './errors.ts'

/** The two api calls a purchase needs, as fetch-like functions so the flow tests against the real api in-process. */
export type BuyApi = {
  quote(partyId: number, body: { token: string; qty: number }): Promise<Response>
  relay(body: { signedDelegate: string }): Promise<Response>
}

export type Bought = { hash: string; total: number; quoteId: string }

async function errorCode(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function buyDrink(
  deps: { api: BuyApi; provider: Provider; sender: string; sign: SignHash },
  partyId: number,
  token: string,
  qty: number,
): Promise<Bought> {
  const q = await deps.api.quote(partyId, { token, qty })
  if (!q.ok) throw new PlayerError(await errorCode(q))
  const { quote, payment } = (await q.json()) as {
    quote: { id: string; unit_price: string; qty: number }
    payment: Call
  }
  const delegate = await delegateFor(deps.provider, deps.sender, payment)
  const signedDelegate = await signDelegate(delegate, deps.sign)
  const r = await deps.api.relay({ signedDelegate })
  if (r.status === 422) {
    const body = (await r.json()) as { error?: string }
    throw new PlayerError(chainFailure(body.error))
  }
  if (!r.ok) throw new PlayerError(await errorCode(r))
  const { hash } = (await r.json()) as { hash: string }
  return { hash, total: Number(quote.unit_price) * quote.qty, quoteId: quote.id }
}

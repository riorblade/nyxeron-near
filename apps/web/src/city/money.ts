// Add money and Cash out through NEAR Intents 1Click (services/api intents.ts). Money comes into and leaves from the
// player's own NEAR account: the api only quotes, and a cash-out is a USDC transfer the player signs (no popup), sent by
// the relayer like a drink. On testnet every quote is a dry run: real numbers, nothing to send.
import type { Provider } from 'near-api-js'
import { type Call, delegateFor, type SignHash, signDelegate } from '../near/delegate.ts'
import { chainFailure, PlayerError } from './errors.ts'

/** Coins and chains offered, as 1Click names them (its /v0/tokens; the api refuses anything it doesn't list). */
export const COINS = [
  { blockchain: 'base', symbol: 'USDC', chain: 'Base' },
  { blockchain: 'arb', symbol: 'USDC', chain: 'Arbitrum' },
  { blockchain: 'eth', symbol: 'USDC', chain: 'Ethereum' },
  { blockchain: 'sol', symbol: 'USDC', chain: 'Solana' },
  { blockchain: 'pol', symbol: 'USDC', chain: 'Polygon' },
  { blockchain: 'eth', symbol: 'USDT', chain: 'Ethereum' },
  { blockchain: 'tron', symbol: 'USDT', chain: 'Tron' },
  { blockchain: 'base', symbol: 'ETH', chain: 'Base' },
  { blockchain: 'eth', symbol: 'ETH', chain: 'Ethereum' },
] as const
export type Coin = (typeof COINS)[number]

export const coinLabel = (c: Coin) => `${c.symbol} on ${c.chain}`

/** What an address on that chain looks like, for the input's placeholder. */
export function addressHint(c: Coin): string {
  if (c.blockchain === 'sol') return 'Solana address'
  if (c.blockchain === 'tron') return 'Tron address (T…)'
  return `${c.chain} address (0x…)`
}

// Cash-out bounds, as the api checks them (CASH_OUT_MIN / CASH_OUT_MAX in intents.ts), in micro-USDC.
export const CASH_OUT_MIN = 1_000_000
export const CASH_OUT_MAX = 1_000_000_000

/** Why a cash-out amount (dollars as typed) can't be sent, or undefined when it can. */
export function cashOutProblem(amount: string, balance: number | undefined): string | undefined {
  if (!/^\d+(\.\d{1,6})?$/.test(amount.trim())) return 'Type an amount in dollars, like 5 or 2.50.'
  const micro = Math.round(Number(amount) * 1_000_000)
  if (micro < CASH_OUT_MIN) return 'Cash out at least $1; below that the fees eat it.'
  if (micro > CASH_OUT_MAX) return 'At most $1,000 at a time.'
  if (balance !== undefined && micro > balance) return "That's more than your balance."
  return undefined
}

/** 1Click's status for a deposit, in words. Final states end the polling. */
const STATUS: Record<string, { text: string; final?: boolean; ok?: boolean }> = {
  PENDING_DEPOSIT: { text: 'Waiting for your deposit.' },
  KNOWN_DEPOSIT_TX: { text: 'Deposit seen, confirming.' },
  PROCESSING: { text: 'Swapping and sending.' },
  SUCCESS: { text: 'Done.', final: true, ok: true },
  INCOMPLETE_DEPOSIT: { text: 'The deposit was less than quoted; it is being refunded.', final: true },
  REFUNDED: { text: 'Refunded to your address.', final: true },
  FAILED: { text: "It didn't go through. Any money sent is refunded.", final: true },
}

export const intentStatus = (status: string) => STATUS[status] ?? { text: status }

export type CashOutApi = { relay(body: { signedDelegate: string }): Promise<Response> }

/** Signs the cash-out `payment` the api quoted (a USDC ft_transfer to 1Click's deposit address) and relays it. */
export async function payCashOut(
  deps: { api: CashOutApi; provider: Provider; sender: string; sign: SignHash },
  payment: Call,
): Promise<string> {
  const delegate = await delegateFor(deps.provider, deps.sender, payment)
  const r = await deps.api.relay({ signedDelegate: await signDelegate(delegate, deps.sign) })
  const body = (await r.json().catch(() => ({}))) as { hash?: string; error?: string }
  if (r.status === 422) throw new PlayerError(chainFailure(body.error))
  if (!r.ok || !body.hash) throw new PlayerError(body.error ?? 'unknown')
  return body.hash
}

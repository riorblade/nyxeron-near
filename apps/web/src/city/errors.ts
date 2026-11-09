// What a player reads when the api says no. Keys are the api's error codes (services/api/README.md).
const MESSAGES: Record<string, string> = {
  unauthorized: 'Your session ended. Sign in again.',
  banned: 'This account is suspended.',
  no_near_account: 'Your wallet is still being set up. Try again in a moment.',
  identity_unavailable: "We can't reach the sign-in service right now. Try again in a moment.",
  party_not_live: "This party isn't open right now.",
  party_over: 'This party is over.',
  no_party: "This party doesn't exist.",
  reprice_needed: 'The stock price moved and the host has to update this drink. Try another one.',
  host_has_no_near_account: "The host can't take payments yet.",
  unknown_token: "That drink isn't on the menu.",
  quotes_off: 'Buying is paused right now.',
  quotes_unavailable: 'Stock prices are unavailable right now. Try again in a moment.',
  relayer_off: 'Buying is paused right now.',
  too_soon: 'Slow down a little and try again.',
  too_many: 'Slow down a little and try again.',
  not_enough_balance: "You don't have enough dollars for that. Add money first.",
  not_enough_usdc: "You don't have enough dollars for that. Add money first.",
  expired: 'That took too long. Tap buy again.',
  prices_changed: 'Prices changed. Tap buy again.',
  paused: 'Buying is paused right now.',
  party_full: "This party can't take more orders right now. Try another drink.",
  refunded: 'Your payment was sent back to you. Try again.',
  // Get test dollars (testnet only)
  faucet_empty: 'The test faucet is empty right now.',
  faucet_failed: "Sending test dollars didn't work. Try again.",
  faucet_off: 'Test dollars are off right now.',
  demo_off: 'Test dollars are off right now.',
  not_testnet: 'Test dollars only exist on the test network.',
  not_onboarded: 'Your account is still being set up. Try again in a moment.',
  // Add money / Cash out (NEAR Intents 1Click)
  intents_off: 'Adding and cashing out money is off right now.',
  intents_unavailable: "We can't reach the money service right now. Try again in a moment.",
  unknown_asset: "That coin isn't available right now. Pick another.",
  quote_failed: "Couldn't get a quote. Check the address and amount, then try again.",
  bad_amount: 'That amount is outside what we can send. Try another.',
  cash_out_paid: 'This cash-out was already sent.',
  cash_out_expired: 'That quote expired. Get a new one.',
  receiver_not_allowed: 'That transfer is not allowed. Get a new quote.',
  amount_not_allowed: 'The amount no longer matches the quote. Get a new one.',
  no_intent: "We can't find that transfer.",
}

// Why the contract refunded a purchase (its `refund` event, passed on by the relay as "refund:<reason>"; the reasons
// are in contracts/nyxeron/src/drinks.rs). The player's money is back in their account in every case.
const REFUNDS: Record<string, string> = {
  expired: 'expired',
  party_closed: 'party_over',
  bad_price: 'prices_changed',
  ceo_mismatch: 'prices_changed',
  bad_amount: 'prices_changed',
  paused: 'paused',
  party_full: 'party_full',
}

/** The api answer's `{ error }` code (or the chain failure inside a 422) as one sentence for the player. */
export function playerMessage(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong. Try again.'
}

/** A relay that reached the chain but failed: find out why in words a player understands. */
export function chainFailure(error: string | undefined): string {
  if (!error) return 'unknown'
  const refund = error.match(/^refund:(\w+)/)?.[1]
  if (refund) return REFUNDS[refund] ?? 'refunded'
  if (/doesn't have enough balance|not enough balance/i.test(error)) return 'not_enough_balance'
  if (/expired|DelegateActionExpired/i.test(error)) return 'expired'
  return 'unknown'
}

export class PlayerError extends Error {
  readonly code: string
  constructor(code: string) {
    super(playerMessage(code))
    this.code = code
  }
}

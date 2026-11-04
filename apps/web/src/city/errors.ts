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
  expired: 'That took too long. Tap buy again.',
}

/** The api answer's `{ error }` code (or the chain failure inside a 422) as one sentence for the player. */
export function playerMessage(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong. Try again.'
}

/** A relay that reached the chain but failed: find out why in words a player understands. */
export function chainFailure(error: string | undefined): string {
  if (!error) return 'unknown'
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

// The purchase flow against the real api code in-process (fake Privy, fake relayer, fake chain reads): what the web
// signs from the api's `payment` must pass the relay's checks unchanged.
import { KeyPair, keyToImplicitAddress, type Provider } from 'near-api-js'
import { describe, expect, it } from 'vitest'
import { fakeIdentity, fakeQuotes, fakeRelayer, testApp } from '../../../../services/api/src/testing.ts'
import { fromHex, type SignHash, toHex } from '../near/delegate.ts'
import { type BuyApi, buyDrink } from './buy.ts'
import { chainFailure, playerMessage } from './errors.ts'

const quoteKey = KeyPair.fromRandom('ed25519')

// Enough of a NEAR provider for building a delegate: a nonce and a block height.
const chain = {
  viewAccessKey: async () => ({ nonce: 41 }),
  viewBlock: async () => ({ header: { height: 1000 } }),
} as unknown as Provider

function setup() {
  const key = KeyPair.fromRandom('ed25519')
  const guest = keyToImplicitAddress(key.getPublicKey())
  const sign: SignHash = async (hash) => toHex(key.sign(fromHex(hash)).signature)
  const relay = fakeRelayer()
  const t = testApp(
    { QUOTE_KEY: quoteKey.toString() },
    fakeIdentity({ guest: { email: 'guest@test.io', nearAccount: guest } }),
    fakeQuotes,
    relay.relayer,
  )
  const api = (token: string): BuyApi => ({
    quote: async (id, body) => t.call('POST', `/api/parties/${id}/quote`, token, body),
    relay: async (body) => t.call('POST', '/api/relay', token, body),
  })
  return { t, guest, sign, relay, api }
}

async function liveParty(t: ReturnType<typeof setup>['t']) {
  const res = await t.call('POST', '/api/parties', 'tok-host', { title: 'Friday', minutes: 10 })
  return ((await res.json()) as { id: number }).id
}

describe('buyDrink', () => {
  it('signs the api payment so the relay accepts and sends it', async () => {
    const s = setup()
    const party = await liveParty(s.t)
    const bought = await buyDrink(
      { api: s.api('tok-guest'), provider: chain, sender: s.guest, sign: s.sign },
      party,
      'tsla',
      3,
    )
    expect(bought.hash).toBe('tx-ok')
    // fakeQuotes TSLA $400 → wholesale 41¢; a new party prices every drink at 1.5× → 62¢ (rounded to the cent).
    expect(bought.total).toBe(3 * 620_000)
    expect(s.relay.calls).toContain(
      `relay:3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af:ft_transfer_call`,
    )
  })

  it('turns a payment that failed on chain for lack of dollars into a sentence', async () => {
    const s = setup()
    const party = await liveParty(s.t)
    s.relay.relayer.relay = async () => ({
      hash: 'tx-x',
      ok: false,
      error: "Smart contract panicked: The account doesn't have enough balance",
    })
    await expect(
      buyDrink({ api: s.api('tok-guest'), provider: chain, sender: s.guest, sign: s.sign }, party, 'tsla', 1),
    ).rejects.toMatchObject({ code: 'not_enough_balance' })
  })

  it('passes the api refusal through as its code', async () => {
    const s = setup()
    const party = await liveParty(s.t)
    await expect(
      buyDrink({ api: s.api('tok-guest'), provider: chain, sender: s.guest, sign: s.sign }, party, 'nope', 1),
    ).rejects.toMatchObject({ code: 'unknown_token' })
    await expect(
      buyDrink({ api: s.api('tok-guest'), provider: chain, sender: s.guest, sign: s.sign }, 999, 'tsla', 1),
    ).rejects.toMatchObject({ code: 'no_party' })
  })
})

describe('player messages', () => {
  it('reads chain failures', () => {
    expect(chainFailure("Smart contract panicked: The account doesn't have enough balance")).toBe('not_enough_balance')
    expect(chainFailure('DelegateActionExpired')).toBe('expired')
    expect(chainFailure('something else')).toBe('unknown')
  })

  it('reads the contract refunds the relay reports as refund:<reason>', () => {
    expect(chainFailure('refund:expired')).toBe('expired')
    expect(chainFailure('refund:party_closed')).toBe('party_over')
    expect(chainFailure('refund:ceo_mismatch')).toBe('prices_changed')
    expect(chainFailure('refund:bad_price')).toBe('prices_changed')
    expect(chainFailure('refund:quote_used')).toBe('refunded')
    for (const code of ['party_over', 'prices_changed', 'refunded'])
      expect(playerMessage(code)).not.toMatch(/went wrong/)
  })

  it('has a sentence for every code the issue names, and a fallback', () => {
    for (const code of ['reprice_needed', 'party_not_live', 'not_enough_balance'])
      expect(playerMessage(code)).not.toMatch(/went wrong/)
    expect(playerMessage('brand_new_code')).toMatch(/went wrong/)
  })
})

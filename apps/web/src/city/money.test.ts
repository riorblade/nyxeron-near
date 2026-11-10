// Cash out against the real api code in-process (fake Privy, fake relayer, fake 1Click): the payment the web signs
// from the api's quote must pass the relay's money rule unchanged.
import { createHash } from 'node:crypto'
import { KeyPair, keyToImplicitAddress, type Provider } from 'near-api-js'
import { describe, expect, it } from 'vitest'
import type { OneClick, OneClickQuote } from '../../../../services/api/src/intents.ts'
import { fakeIdentity, fakeQuotes, fakeRelayer, testApp } from '../../../../services/api/src/testing.ts'
import type { Call } from '../near/delegate.ts'
import { fromHex, type SignHash, toHex } from '../near/delegate.ts'
import { cashOutProblem, COINS, intentStatus, payCashOut } from './money.ts'

const USDC_MAIN = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'

const chain = {
  viewAccessKey: async () => ({ nonce: 7 }),
  viewBlock: async () => ({ header: { height: 500 } }),
} as unknown as Provider

function fakeOneClick() {
  const submitted: string[] = []
  const oneclick: OneClick = {
    async tokens() {
      return [
        { assetId: `nep141:${USDC_MAIN}`, decimals: 6, blockchain: 'near', symbol: 'USDC', price: 1 },
        { assetId: 'nep141:base-usdc.test', decimals: 6, blockchain: 'base', symbol: 'USDC', price: 1 },
      ]
    },
    async quote(req) {
      const depositAddress = req.dry ? undefined : createHash('sha256').update(req.amount).digest('hex')
      return {
        correlationId: `corr-${req.amount}`,
        quote: {
          ...(depositAddress ? { depositAddress } : {}),
          amountIn: req.amount,
          amountOut: req.amount,
          amountOutFormatted: '5.24',
          deadline: req.deadline,
        },
      } satisfies OneClickQuote
    },
    async status() {
      return { status: 'PENDING_DEPOSIT' }
    },
    async submitDeposit(d) {
      submitted.push(d.txHash)
    },
  }
  return { oneclick, submitted }
}

function setup(env: Record<string, string>) {
  const key = KeyPair.fromRandom('ed25519')
  const player = keyToImplicitAddress(key.getPublicKey())
  const sign: SignHash = async (hash) => toHex(key.sign(fromHex(hash)).signature)
  const relay = fakeRelayer()
  const fc = fakeOneClick()
  const t = testApp(
    env,
    fakeIdentity({ p: { email: 'p@test.io', nearAccount: player } }),
    fakeQuotes,
    relay.relayer,
    fc.oneclick,
  )
  relay.balances.set(`${USDC_MAIN}:${player}`, 20_000_000n) // $20, so the relay's balance check passes
  return { t, player, sign, relay, fc }
}

const to = { blockchain: 'base', symbol: 'USDC', address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' }

describe('payCashOut', () => {
  it('signs the quoted USDC transfer so the relay sends it and tells 1Click', async () => {
    const s = setup({ NEAR_NETWORK: 'mainnet', CONTRACT_ID: 'nyxeron.near' })
    const q = (await (await s.t.call('POST', '/api/me/cash-out', 'tok-p', { to, amount: '5.25' })).json()) as {
      dry: boolean
      payment: Call
    }
    expect(q.dry).toBe(false)
    const hash = await payCashOut(
      {
        api: { relay: async (body) => s.t.call('POST', '/api/relay', 'tok-p', body) },
        provider: chain,
        sender: s.player,
        sign: s.sign,
      },
      q.payment,
    )
    expect(hash).toBe('tx-ok')
    expect(s.relay.calls).toContain(`relay:${USDC_MAIN}:ft_transfer`)
    expect(s.fc.submitted).toEqual(['tx-ok'])
  })

  it('is refused a second time: a quote is paid once', async () => {
    const s = setup({ NEAR_NETWORK: 'mainnet', CONTRACT_ID: 'nyxeron.near' })
    const q = (await (await s.t.call('POST', '/api/me/cash-out', 'tok-p', { to, amount: '2' })).json()) as {
      payment: Call
    }
    const deps = {
      api: { relay: async (body: { signedDelegate: string }) => s.t.call('POST', '/api/relay', 'tok-p', body) },
      provider: chain,
      sender: s.player,
      sign: s.sign,
    }
    await payCashOut(deps, q.payment)
    await expect(payCashOut(deps, q.payment)).rejects.toMatchObject({ code: 'cash_out_paid' })
  })

  it('on testnet the quote is a dry run with nothing to sign', async () => {
    const s = setup({})
    const q = (await (await s.t.call('POST', '/api/me/cash-out', 'tok-p', { to, amount: '5' })).json()) as Record<
      string,
      unknown
    >
    expect(q).toMatchObject({ dry: true })
    expect(q.payment).toBeUndefined()
  })
})

describe('money helpers', () => {
  it('checks a cash-out amount the way the api does', () => {
    expect(cashOutProblem('5', 20_000_000)).toBeUndefined()
    expect(cashOutProblem('2.50', undefined)).toBeUndefined()
    expect(cashOutProblem('0.5', 20_000_000)).toMatch(/at least \$1/)
    expect(cashOutProblem('1001', undefined)).toMatch(/\$1,000/)
    expect(cashOutProblem('25', 20_000_000)).toMatch(/balance/)
    for (const bad of ['', 'abc', '1e3', '-2', '1.1234567']) expect(cashOutProblem(bad, undefined), bad).toBeDefined()
  })

  it('has words for every 1Click status and knows which are final', () => {
    expect(intentStatus('SUCCESS')).toMatchObject({ final: true, ok: true })
    expect(intentStatus('REFUNDED').final).toBe(true)
    expect(intentStatus('PROCESSING').final).toBeUndefined()
    expect(intentStatus('SOMETHING_NEW').text).toBe('SOMETHING_NEW')
  })

  it('offers each coin and chain once', () => {
    const keys = COINS.map((c) => `${c.blockchain}:${c.symbol}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

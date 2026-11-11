import { createPublicKey, verify } from 'node:crypto'
import { KeyPair, PublicKey } from 'near-api-js'
import { describe, expect, it, vi } from 'vitest'
import { all } from './db.ts'
import { HOUSE_MINUTES, PAYMENT_GAS, QUOTE_TTL_MS } from './parties.ts'
import type { Quotes } from './quotes.ts'
import { fakeIdentity, fakeQuotes, testApp } from './testing.ts'

const quoteKey = KeyPair.fromRandom('ed25519')
const env = { QUOTE_KEY: quoteKey.toString() }

// fakeQuotes: TSLA $400, NVDA $200, SPY $600 → wholesale 41¢, 21¢, 61¢ (0.001 share + 1 %, rounded up).
const W = { tsla: 410_000, nvda: 210_000, spy: 610_000 }

function setup(opts: { env?: Record<string, string>; quotes?: Quotes } = {}) {
  const t = testApp(opts.env ?? env, fakeIdentity(), opts.quotes ?? fakeQuotes)
  const party = async (token = 'tok-host', body: object = { title: 'Friday Night', minutes: 10 }) =>
    t.call('POST', '/api/parties', token, body)
  return { ...t, party }
}
const json = async (res: Response) => (await res.json()) as Record<string, unknown> & { id: number }

function verifyPayment(msg: string) {
  const { quote, sig } = JSON.parse(msg) as { quote: string; sig: string }
  const bytes = Buffer.from(quote, 'base64')
  const raw = Buffer.from(PublicKey.fromString(quoteKey.getPublicKey().toString()).data)
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
  return { valid: verify(null, bytes, key, Buffer.from(sig, 'base64')), quote: JSON.parse(bytes.toString('utf8')) }
}

describe('GET /api/config', () => {
  it('tells the web the network, contract, USDC, menu and the quote key to set on the contract', async () => {
    const body = await json(await setup().call('GET', '/api/config'))
    expect(body).toMatchObject({
      network: 'testnet',
      contractId: 'nyxeron.testnet',
      usdcId: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
      quoteKey: quoteKey.getPublicKey().toString(),
    })
    expect(body.menu).toHaveLength(10)
  })
})

describe('parties', () => {
  it('a host opens a party: every priced stock starts at 1.5× wholesale', async () => {
    const { party } = setup()
    const res = await party()
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body).toMatchObject({
      title: 'Friday Night',
      live: true,
      host: { nearAccount: expect.stringMatching(/^[0-9a-f]{64}$/) },
    })
    expect(body.menu).toEqual([
      {
        token: 'tsla',
        ticker: 'TSLA',
        name: 'Tesla',
        price: 620_000,
        listPrice: 620_000,
        wholesale: W.tsla,
        maxPrice: W.tsla * 3,
      },
      {
        token: 'nvda',
        ticker: 'NVDA',
        name: 'NVIDIA',
        price: 320_000,
        listPrice: 320_000,
        wholesale: W.nvda,
        maxPrice: W.nvda * 3,
      },
      {
        token: 'spy',
        ticker: 'SPY',
        name: 'S&P 500',
        price: 920_000,
        listPrice: 920_000,
        wholesale: W.spy,
        maxPrice: W.spy * 3,
      },
    ])
  })

  it('lists live parties and refuses a bad title', async () => {
    const { party, call } = setup()
    await party()
    const list = (await json(await call('GET', '/api/parties', 'tok-guest'))) as unknown as { parties: unknown[] }
    expect(list.parties).toHaveLength(1)
    expect((await party('tok-host', { title: 'x' })).status).toBe(400)
  })

  it('needs a NEAR account and an unbanned host', async () => {
    const noNear = testApp(env, fakeIdentity({ host: { email: 'h@test.io', nearAccount: '' } }), fakeQuotes)
    expect((await noNear.call('POST', '/api/parties', 'tok-host', { title: 'Night' })).status).toBe(409)
    const { party, call, ban } = setup()
    await call('GET', '/api/me', 'tok-host')
    ban('host')
    expect((await party()).status).toBe(403)
  })
})

describe('House Party (testnet + DEMO_MODE)', () => {
  const demo = { ...env, DEMO_MODE: 'true', RELAYER_ACCOUNT_ID: 'relayer.testnet', RELAYER_KEY: quoteKey.toString() }
  type List = { parties: { id: number; title: string; demo: boolean; endsAt: number }[] }
  const list = async (t: ReturnType<typeof setup>) =>
    (await (await t.call('GET', '/api/parties', 'tok-guest')).json()) as List

  it('is always live, listed first, and a guest can buy there', async () => {
    const t = setup({ env: demo })
    await t.party()
    const { parties } = await list(t)
    expect(parties.map((p) => [p.title, p.demo])).toEqual([
      ['House Party', true],
      ['Friday Night', false],
    ])
    expect((await list(t)).parties.filter((p) => p.demo)).toHaveLength(1) // a second list opens no second one
    const house = await json(await t.call('GET', `/api/parties/${parties[0]!.id}`, 'tok-guest'))
    expect(house).toMatchObject({
      demo: true,
      live: true,
      host: { name: 'NYXERON House', nearAccount: 'relayer.testnet' },
    })
    const q = await t.call('POST', `/api/parties/${parties[0]!.id}/quote`, 'tok-guest', { token: 'tsla', qty: 3 })
    expect(q.status).toBe(200)
  })

  it('opens the next one when it ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t = setup({ env: demo })
      const first = (await list(t)).parties[0]!
      vi.setSystemTime(first.endsAt)
      const next = (await list(t)).parties[0]!
      expect(next).toMatchObject({ demo: true })
      expect(next.id).not.toBe(first.id)
      expect(next.endsAt - first.endsAt).toBe(HOUSE_MINUTES * 60_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never opens without DEMO_MODE (so never on mainnet)', async () => {
    const t = setup({ env: { ...demo, DEMO_MODE: 'false' } })
    expect((await list(t)).parties).toEqual([])
  })
})

describe('POST /api/parties/:id/moves', () => {
  type Menu = { token: string; price: number; listPrice: number }[]
  const move = (t: ReturnType<typeof setup>, id: number, kind: string, token = 'tok-host') =>
    t.call('POST', `/api/parties/${id}/moves`, token, { kind })

  it('happy hour: every drink 20 % off in the menu and the signed quote, once a party, for 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t = setup()
      const { id } = await json(await t.party('tok-host', { title: 'Friday Night', minutes: 30 }))
      const res = await move(t, id, 'happyHour')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { menu: Menu; moves: { kind: string }[]; happyHourUsed: boolean }
      expect(body.moves.map((m) => m.kind)).toEqual(['happyHour'])
      // 62¢ → 49.6¢ → 50¢ (cents); 32¢ → 26¢; 92¢ → 74¢.
      expect(body.menu.map((m) => [m.token, m.price, m.listPrice])).toEqual([
        ['tsla', 500_000, 620_000],
        ['nvda', 260_000, 320_000],
        ['spy', 740_000, 920_000],
      ])
      const q = (await (
        await t.call('POST', `/api/parties/${id}/quote`, 'tok-guest', { token: 'tsla', qty: 2 })
      ).json()) as { quote: { unit_price: string }; payment: { args: { amount: string } } }
      expect(q.quote.unit_price).toBe('500000')
      expect(q.payment.args.amount).toBe('1000000')
      expect((await move(t, id, 'happyHour')).status).toBe(429) // once a party
      vi.setSystemTime(Date.now() + 5 * 60_000)
      const after = (await json(await t.call('GET', `/api/parties/${id}`, 'tok-guest'))) as unknown as { menu: Menu }
      expect(after.menu[0]).toMatchObject({ price: 620_000, listPrice: 620_000 })
      expect((await move(t, id, 'happyHour')).status).toBe(429) // still once, after it ended
    } finally {
      vi.useRealTimers()
    }
  })

  it('never prices a drink below wholesale', async () => {
    const t = setup()
    const { id } = await json(await t.party())
    await t.call('PUT', `/api/parties/${id}/prices`, 'tok-host', { prices: { tsla: W.tsla } })
    const body = (await (await move(t, id, 'happyHour')).json()) as { menu: Menu }
    expect(body.menu[0]).toMatchObject({ token: 'tsla', price: W.tsla })
  })

  it('host only, live parties only; pyro at most every 10 s, anthem not while it runs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t = setup()
      const { id } = await json(await t.party())
      expect((await move(t, id, 'pyro', 'tok-guest')).status).toBe(403)
      expect((await move(t, id, 'confetti')).status).toBe(400)
      const first = (await (await move(t, id, 'pyro')).json()) as { pyroAt: number }
      expect(first.pyroAt).toBe(Date.now())
      expect((await move(t, id, 'pyro')).status).toBe(429)
      vi.setSystemTime(Date.now() + 10_000)
      expect((await move(t, id, 'pyro')).status).toBe(200)
      expect((await move(t, id, 'anthem')).status).toBe(200)
      expect((await move(t, id, 'anthem')).status).toBe(429)
      vi.setSystemTime(Date.now() + 10 * 60_000) // the party is over
      expect((await move(t, id, 'mcHype')).status).toBe(409)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PUT /api/parties/:id/prices', () => {
  it('lets the host price between wholesale and 3× wholesale, nobody else', async () => {
    const { party, call } = setup()
    const { id } = await json(await party())
    const ok = await call('PUT', `/api/parties/${id}/prices`, 'tok-host', { prices: { tsla: 800_000 } })
    expect(((await json(ok)).menu as { token: string; price: number }[]).find((m) => m.token === 'tsla')?.price).toBe(
      800_000,
    )
    const err = async (token: string, prices: object) =>
      json(await call('PUT', `/api/parties/${id}/prices`, token, { prices }))
    expect(await err('tok-guest', { tsla: 800_000 })).toEqual({ error: 'not_host' })
    expect(await err('tok-host', { tsla: W.tsla - 1 })).toEqual({ error: 'below_wholesale' })
    expect(await err('tok-host', { tsla: W.tsla * 3 + 1 })).toEqual({ error: 'above_cap' })
    expect(await err('tok-host', { aapl: 500_000 })).toEqual({ error: 'unknown_token' })
  })

  it('is closed once the party is over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { party, call } = setup()
      const { id } = await json(await party())
      vi.setSystemTime(Date.now() + 11 * 60_000)
      expect(
        await json(await call('PUT', `/api/parties/${id}/prices`, 'tok-host', { prices: { tsla: 800_000 } })),
      ).toEqual({
        error: 'party_over',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('POST /api/parties/:id/quote', () => {
  async function quoted(opts: Parameters<typeof setup>[0] = {}, body: object = { token: 'tsla', qty: 3 }) {
    const t = setup(opts)
    const { id } = await json(await t.party())
    const res = await t.call('POST', `/api/parties/${id}/quote`, 'tok-guest', body)
    return { ...t, id, res }
  }

  it('signs a quote the contract can check, and hands the client the exact payment to sign', async () => {
    const { res, call, db, id } = await quoted()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      quote: Record<string, unknown>
      payment: {
        receiverId: string
        method: string
        args: { receiver_id: string; amount: string; msg: string }
        deposit: string
        gas: string
      }
    }
    const guest = ((await (await call('GET', '/api/me', 'tok-guest')).json()) as { nearAccount: string }).nearAccount
    const host = ((await (await call('GET', '/api/me', 'tok-host')).json()) as { nearAccount: string }).nearAccount
    const { valid, quote } = verifyPayment(body.payment.args.msg)
    expect(valid).toBe(true)
    expect(quote).toEqual(body.quote)
    expect(quote).toMatchObject({
      v: 2,
      contract: 'nyxeron.testnet',
      party: expect.stringMatching(new RegExp(`^[0-9a-f]{8}-${id}$`)),
      buyer: guest,
      ceo: host,
      token: 'tsla',
      qty: 3,
      unit_price: '620000',
      unit_wholesale: String(W.tsla),
    })
    expect(quote.id).toMatch(/^q_[A-Za-z0-9_-]{22}$/)
    expect((quote.expires_ms as number) - Date.now()).toBeLessThanOrEqual(QUOTE_TTL_MS)
    expect(body.payment).toMatchObject({
      receiverId: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
      method: 'ft_transfer_call',
      args: { receiver_id: 'nyxeron.testnet', amount: String(620_000 * 3) },
      deposit: '1',
      gas: PAYMENT_GAS,
    })
    expect(all(db, 'SELECT id, qty, unit_price FROM quotes')).toEqual([{ id: quote.id, qty: 3, unit_price: 620_000 }])
  })

  it('a tampered quote no longer verifies', async () => {
    const { res } = await quoted()
    const { payment } = (await res.json()) as { payment: { args: { msg: string } } }
    const msg = JSON.parse(payment.args.msg) as { quote: string; sig: string }
    const edited = Buffer.from(Buffer.from(msg.quote, 'base64').toString().replace('"qty":3', '"qty":30')).toString(
      'base64',
    )
    expect(verifyPayment(JSON.stringify({ ...msg, quote: edited })).valid).toBe(false)
  })

  it.each([
    ['qty 0', { token: 'tsla', qty: 0 }, 400, 'bad_request'],
    ['qty above 20', { token: 'tsla', qty: 21 }, 400, 'bad_request'],
    ['a stock not on the menu', { token: 'aapl', qty: 1 }, 400, 'unknown_token'],
    ['a made-up token', { token: 'toString', qty: 1 }, 400, 'unknown_token'],
  ])('refuses %s', async (_, body, status, error) => {
    const { res } = await quoted({}, body)
    expect(res.status).toBe(status)
    expect((await res.json()) as object).toMatchObject({ error })
  })

  it('refuses when the market moved above the host’s price, until the host reprices', async () => {
    let tsla = 400
    const moving: Quotes = {
      async latest() {
        return { at: 0, stale: false, prices: { tsla: { usd: tsla, change24h: 0, liquidityUsd: 1e6 } } }
      },
      async spot() {
        return tsla
      },
    }
    const t = setup({ quotes: moving })
    const { id } = await json(await t.party()) // TSLA priced at 62¢ while wholesale is 41¢
    tsla = 700 // wholesale is now 71¢
    const res = await t.call('POST', `/api/parties/${id}/quote`, 'tok-guest', { token: 'tsla', qty: 1 })
    expect(await res.json()).toEqual({ error: 'reprice_needed' })
    await t.call('PUT', `/api/parties/${id}/prices`, 'tok-host', { prices: { tsla: 900_000 } })
    expect((await t.call('POST', `/api/parties/${id}/quote`, 'tok-guest', { token: 'tsla', qty: 1 })).status).toBe(200)
  })

  it('refuses after the party ends, without a quote key, and without a NEAR account', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t = setup()
      const { id } = await json(await t.party())
      vi.setSystemTime(Date.now() + 11 * 60_000)
      expect(
        await json(await t.call('POST', `/api/parties/${id}/quote`, 'tok-guest', { token: 'tsla', qty: 1 })),
      ).toEqual({
        error: 'party_not_live',
      })
    } finally {
      vi.useRealTimers()
    }
    const off = await quoted({ env: {} })
    expect(await off.res.json()).toEqual({ error: 'quotes_off' })
    const noNear = testApp(env, fakeIdentity({ guest: { email: 'g@test.io', nearAccount: '' } }), fakeQuotes)
    const { id } = await json(await noNear.call('POST', '/api/parties', 'tok-host', { title: 'Night' }))
    expect(
      await json(await noNear.call('POST', `/api/parties/${id}/quote`, 'tok-guest', { token: 'tsla', qty: 1 })),
    ).toEqual({
      error: 'no_near_account',
    })
  })

  it('404 for a party that does not exist', async () => {
    const { call } = setup()
    expect((await call('POST', '/api/parties/999/quote', 'tok-guest', { token: 'tsla', qty: 1 })).status).toBe(404)
  })
})

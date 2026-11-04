// 20 · /api/onboard and /api/relay against testnet, in-process: the real api code, the real relayer key (spike 02),
// Circle's testnet USDC; only the Privy login is faked. A fresh player with 0 NEAR is onboarded, then sends a drink
// payment (USDC ft_transfer_call to our contract). The player holds no testnet USDC, so the payment is expected to
// fail on chain: the point is that the api decodes, checks, relays and records it.
import { createHash } from 'node:crypto'
import {
  actions,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  KeyPair,
  keyToImplicitAddress,
} from 'near-api-js'
import { loadConfig } from '../services/api/src/config.ts'
import { all, openDb } from '../services/api/src/db.ts'
import { createApp } from '../services/api/src/app.ts'
import { nearProvider, nearRelayer } from '../services/api/src/near.ts'
import { fakeIdentity, fakeQuotes } from '../services/api/src/testing.ts'
import { needEnv, save, timed } from './lib.ts'

const cfg = loadConfig({
  PRIVY_APP_ID: 'spike',
  PRIVY_APP_SECRET: 'spike',
  NEAR_NETWORK: 'testnet',
  RELAYER_ACCOUNT_ID: needEnv('SPIKE_RELAYER'),
  RELAYER_KEY: needEnv('SPIKE_RELAYER_KEY'),
})
const key = KeyPair.fromRandom('ed25519')
const player = keyToImplicitAddress(key.getPublicKey())
const db = openDb(':memory:')
const app = createApp({
  cfg,
  db,
  identity: fakeIdentity({ dj: { email: 'dj@test.io', nearAccount: player } }),
  quotes: fakeQuotes,
  relayer: nearRelayer(cfg),
})
const call = (path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { authorization: 'Bearer tok-dj', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

const onboard = await timed(async () => {
  const res = await call('/api/onboard')
  return { status: res.status, body: await res.json() }
})

// The browser's job: build and sign the delegate with the player's own key (nonce from the chain).
const provider = nearProvider('testnet')
const access = (await provider.viewAccessKey({
  accountId: player,
  publicKey: key.getPublicKey().toString(),
})) as unknown as { nonce: bigint | number }
const head = await provider.viewBlock({ finality: 'final' })
const delegateAction = buildDelegateAction({
  senderId: player,
  receiverId: cfg.USDC_CONTRACT_ID,
  nonce: BigInt(access.nonce) + 1n,
  maxBlockHeight: BigInt(head.header.height) + 120n,
  publicKey: key.getPublicKey(),
  actions: [
    actions.functionCall(
      'ft_transfer_call',
      { receiver_id: cfg.CONTRACT_ID, amount: '410000', msg: '{"spike":20}' },
      100_000_000_000_000n,
      1n,
    ),
  ],
})
const hash = createHash('sha256').update(encodeDelegateAction(delegateAction)).digest()
const signedDelegate = Buffer.from(
  encodeSignedDelegate({
    delegateAction,
    signature: { ed25519Signature: { data: key.sign(hash).signature } },
  } as never),
).toString('base64')

const relay = await timed(async () => {
  const res = await call('/api/relay', { signedDelegate })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
})
const refused = await call('/api/relay', {
  signedDelegate: Buffer.from(
    encodeSignedDelegate({
      delegateAction: buildDelegateAction({ ...delegateAction, receiverId: 'guestbook.near-examples.testnet' }),
      signature: { ed25519Signature: { data: key.sign(hash).signature } },
    } as never),
  ).toString('base64'),
})

save('20-api-relay-live', {
  player,
  onboard: { ms: onboard.ms, ...onboard.value },
  relayDrinkPayment: {
    ms: relay.ms,
    status: relay.value.status,
    hash: relay.value.body.hash,
    ok: relay.value.body.ok,
    error: String(relay.value.body.error ?? '').slice(0, 200),
  },
  recorded: all(db, 'SELECT receiver, method, tx_hash, ok FROM relays'),
  refusedOtherReceiver: { status: refused.status, body: await refused.json() },
})

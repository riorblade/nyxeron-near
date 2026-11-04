// 19 · The relay wire format, end to end on testnet: a zero-NEAR player signs a delegate, it travels as base64 borsh
// (what the browser will send to /api/relay), the server decodes it, checks the signature locally, and the relayer
// submits it. This is the format services/api/src/relay.ts accepts.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { deserialize } from 'borsh'
import {
  Account,
  actions,
  encodeDelegateAction,
  encodeSignedDelegate,
  KeyPair,
  type KeyPairString,
  keyToImplicitAddress,
  SCHEMA,
  teraToGas,
} from 'near-api-js'
import { needEnv, provider, save, timed } from './lib.ts'

const p = provider('testnet')
const relayer = new Account(needEnv('SPIKE_RELAYER'), p, needEnv('SPIKE_RELAYER_KEY') as KeyPairString)

// A brand-new player with no NEAR: the relayer creates the account (spike 04).
const key = KeyPair.fromRandom('ed25519')
const playerId = keyToImplicitAddress(key.getPublicKey())
await relayer.transfer({ receiverId: playerId, amount: 0n })
const player = new Account(playerId, p, key.toString() as KeyPairString)

// Browser side: sign, encode.
const meta = await player.createSignedMetaTransaction({
  receiverId: 'guestbook.near-examples.testnet',
  actions: [actions.functionCall('add_message', { text: 'spike 19: relay wire' }, teraToGas('30'), 0n)],
})
const wire = Buffer.from(encodeSignedDelegate(meta.signedDelegate)).toString('base64')

// Server side: decode, check the signature, relay.
type Decoded = {
  delegateAction: Parameters<typeof encodeDelegateAction>[0]
  signature: { ed25519Signature?: { data: number[] } }
}
const decoded = deserialize(SCHEMA.SignedDelegate, Buffer.from(wire, 'base64')) as unknown as Decoded
const da = decoded.delegateAction as unknown as {
  senderId: string
  receiverId: string
  publicKey: { ed25519Key?: { data: number[] } }
  actions: { functionCall?: { methodName: string; deposit: bigint; gas: bigint } }[]
}
const hash = createHash('sha256').update(encodeDelegateAction(decoded.delegateAction)).digest()
const pub = Buffer.from(da.publicKey.ed25519Key!.data)
const jwk = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') }, format: 'jwk' })
const signatureValid = verify(null, hash, jwk, Buffer.from(decoded.signature.ed25519Signature!.data))
// The decoded object has the exact borsh shape, so it can be relayed as is.
const rebuilt = decoded as unknown as Parameters<typeof relayer.relayMetaTransaction>[0]
const sent = await timed(() => relayer.relayMetaTransaction(rebuilt))
const outcome = sent.value as { transaction: { hash: string }; status: unknown }

save('19-relay-wire', {
  playerId,
  wireBytes: Buffer.from(wire, 'base64').length,
  decoded: {
    senderId: da.senderId,
    receiverId: da.receiverId,
    method: da.actions[0]?.functionCall?.methodName,
    deposit: String(da.actions[0]?.functionCall?.deposit),
    gas: String(da.actions[0]?.functionCall?.gas),
  },
  signatureValid,
  relay: { ms: sent.ms, hash: outcome.transaction.hash, status: outcome.status },
})

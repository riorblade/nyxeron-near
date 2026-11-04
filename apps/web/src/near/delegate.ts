import {
  actions,
  buildDelegateAction,
  type DelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  KeyType,
  type Provider,
  PublicKey,
  Signature,
  type SignedDelegate,
} from 'near-api-js'

// Signs a 32-byte hash with the player's key and returns a 64-byte ed25519 signature. In the app this is Privy's
// signRawHash on the player's NEAR wallet (hex in, hex out); in tests a local key.
export type SignHash = (hash: `0x${string}`) => Promise<`0x${string}`>

const IMPLICIT = /^[0-9a-f]{64}$/
// The relayer refuses more than 150 TGas; the payment burns ≈ 11.5 TGas (#22), so 100 leaves room.
const PAYMENT_GAS = 100_000_000_000_000n
// How long the delegate stays valid, in blocks (≈ 1 s each).
const VALID_BLOCKS = 120n

export const toHex = (bytes: Uint8Array): `0x${string}` =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '')
  if (!/^(?:[0-9a-f]{2})*$/i.test(clean)) throw new Error(`not hex: ${hex.slice(0, 20)}`)
  return Uint8Array.from(clean.match(/../g) ?? [], (b) => parseInt(b, 16))
}

const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))

// A Privy NEAR wallet is an implicit account: the account id is the hex of its ed25519 public key.
export function implicitKey(account: string): PublicKey {
  if (!IMPLICIT.test(account)) throw new Error(`not an implicit account: ${account}`)
  return new PublicKey({ keyType: KeyType.ED25519, data: fromHex(account) })
}

// A USDC ft_transfer_call to our contract, as the relayer allows it: one call, 1 yocto, nonce and expiry from chain.
export async function paymentDelegate(
  provider: Provider,
  p: { sender: string; usdc: string; contract: string; amount: string; msg: string },
): Promise<DelegateAction> {
  const publicKey = implicitKey(p.sender)
  const [access, head] = await Promise.all([
    provider.viewAccessKey({ accountId: p.sender, publicKey: publicKey.toString() }),
    provider.viewBlock({ finality: 'final' }),
  ])
  return buildDelegateAction({
    senderId: p.sender,
    receiverId: p.usdc,
    nonce: BigInt((access as unknown as { nonce: bigint | number }).nonce) + 1n,
    maxBlockHeight: BigInt(head.header.height) + VALID_BLOCKS,
    publicKey,
    actions: [
      actions.functionCall(
        'ft_transfer_call',
        { receiver_id: p.contract, amount: p.amount, msg: p.msg },
        PAYMENT_GAS,
        1n,
      ),
    ],
  })
}

// NEP-366: sign sha256(borsh(delegate)) and return the SignedDelegate as base64, the body /api/relay takes.
export async function signDelegate(delegateAction: DelegateAction, sign: SignHash): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encodeDelegateAction(delegateAction) as BufferSource),
  )
  const sig = fromHex(await sign(toHex(hash)))
  if (sig.length !== 64) throw new Error(`expected a 64-byte signature, got ${sig.length}`)
  // SignedDelegate is a type only at runtime; the encoder takes the plain shape.
  const signed: SignedDelegate = { delegateAction, signature: new Signature({ keyType: KeyType.ED25519, data: sig }) }
  return toBase64(encodeSignedDelegate(signed))
}

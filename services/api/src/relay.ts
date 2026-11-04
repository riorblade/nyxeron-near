import { createHash, createPublicKey, verify } from 'node:crypto'
import { deserialize } from 'borsh'
import { Hono } from 'hono'
import { encodeDelegateAction, SCHEMA } from 'near-api-js'
import { z } from 'zod'
import { type AppEnv, type Identity, requireActive, requireUser } from './auth.ts'
import type { Config } from './config.ts'
import { type Db, run } from './db.ts'
import { AppError, rateLimit, validate } from './http.ts'
import type { Relayer } from './near.ts'

// What the browser sends: a NEP-366 SignedDelegate, borsh-encoded, base64 (spike 19 proved the round trip).
export type SignedDelegateWire = {
  delegateAction: {
    senderId: string
    receiverId: string
    actions: { functionCall?: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }[]
    nonce: bigint
    maxBlockHeight: bigint
    publicKey: { ed25519Key?: { data: number[] } }
  }
  signature: { ed25519Signature?: { data: number[] } }
}

export function decodeDelegate(base64: string): SignedDelegateWire {
  try {
    return deserialize(SCHEMA.SignedDelegate, Buffer.from(base64, 'base64')) as unknown as SignedDelegateWire
  } catch {
    throw new AppError(400, 'bad_delegate')
  }
}

// The player's own key signed it: checked here so a forged delegate never costs the relayer gas.
export function signatureValid(d: SignedDelegateWire): boolean {
  const pub = d.delegateAction.publicKey.ed25519Key?.data
  const sig = d.signature.ed25519Signature?.data
  if (!pub || !sig) return false
  const hash = createHash('sha256')
    .update(encodeDelegateAction(d.delegateAction as unknown as Parameters<typeof encodeDelegateAction>[0]))
    .digest()
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub).toString('base64url') },
    format: 'jwk',
  })
  return verify(null, hash, key, Buffer.from(sig))
}

const MAX_GAS = 150_000_000_000_000n // 150 TGas

// The relayer pays any attached deposit (spike 03), so it only ever relays these exact calls. Returns a refusal code.
export function checkDelegate(
  d: SignedDelegateWire,
  ctx: { sender: string; contractId: string; usdcId: string },
): string | undefined {
  const { senderId, receiverId, actions, publicKey } = d.delegateAction
  if (senderId !== ctx.sender) return 'wrong_sender'
  // A Privy NEAR wallet is an implicit account: its id is its key. Any other key would be rejected on chain after the
  // relayer had paid for it.
  if (/^[0-9a-f]{64}$/.test(senderId) && Buffer.from(publicKey.ed25519Key?.data ?? []).toString('hex') !== senderId)
    return 'wrong_key'
  if (actions.length !== 1 || !actions[0]?.functionCall) return 'one_call_only'
  const { methodName, args, gas, deposit } = actions[0].functionCall
  if (gas > MAX_GAS) return 'gas_too_high'
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(Buffer.from(args).toString('utf8')) as Record<string, unknown>
  } catch {
    return 'bad_args'
  }
  if (receiverId === ctx.usdcId) {
    // Paying for a drink: USDC to our contract only, with exactly the 1 yocto NEP-141 requires.
    if (methodName !== 'ft_transfer_call') return 'method_not_allowed'
    if (parsed.receiver_id !== ctx.contractId) return 'receiver_not_allowed'
    if (deposit !== 1n) return 'deposit_not_allowed'
    return undefined
  }
  if (receiverId === ctx.contractId) {
    if (methodName !== 'claim_margin') return 'method_not_allowed'
    if (deposit !== 0n) return 'deposit_not_allowed'
    return undefined
  }
  return 'receiver_not_allowed'
}

export function relayRoutes(deps: { cfg: Config; db: Db; identity: Identity; relayer?: Relayer }) {
  const { cfg, db } = deps
  const limited = rateLimit(20, 60_000)
  return new Hono<AppEnv>()
    .use(requireUser(deps))
    .post(
      '/',
      requireActive,
      validate('json', z.object({ signedDelegate: z.string().min(1).max(4096) })),
      async (c) => {
        if (!deps.relayer) throw new AppError(503, 'relayer_off')
        const user = c.var.user
        if (!user.near_account) throw new AppError(409, 'no_near_account')
        limited(user.id)
        const d = decodeDelegate(c.req.valid('json').signedDelegate)
        const refused = checkDelegate(d, {
          sender: user.near_account,
          contractId: cfg.CONTRACT_ID,
          usdcId: cfg.USDC_CONTRACT_ID,
        })
        if (refused) throw new AppError(403, refused)
        if (!signatureValid(d)) throw new AppError(403, 'bad_signature')
        const result = await deps.relayer.relay(d)
        run(
          db,
          'INSERT INTO relays (user_id, receiver, method, tx_hash, ok, error, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          user.id,
          d.delegateAction.receiverId,
          d.delegateAction.actions[0]!.functionCall!.methodName,
          result.hash,
          result.ok ? 1 : 0,
          result.error ?? '',
          Date.now(),
        )
        return c.json(result, result.ok ? 200 : 422)
      },
    )
}

import { createHash, createPublicKey, verify } from 'node:crypto'
import { deserialize } from 'borsh'
import { Hono } from 'hono'
import { encodeDelegateAction, SCHEMA } from 'near-api-js'
import { z } from 'zod'
import { type AppEnv, type Identity, requireActive, requireUser } from './auth.ts'
import type { Config } from './config.ts'
import { type Db, run } from './db.ts'
import { AppError, rateLimit, validate } from './http.ts'
import { cashOutPaid, type OneClick, openCashOut, releaseCashOut, reserveCashOut } from './intents.ts'
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

export type CashOutLookup = (depositAddress: string) => { amount: string; expired: boolean; paid: boolean } | undefined

// The relayer pays any attached deposit (spike 03), so it only ever relays these exact calls. Returns a refusal code.
export function checkDelegate(
  d: SignedDelegateWire,
  ctx: { sender: string; contractId: string; usdcId: string; cashOut?: CashOutLookup },
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
    if (methodName === 'ft_transfer') {
      // Cashing out: only to a 1Click deposit address this api quoted to this player, once, for the quoted amount.
      if (deposit !== 1n) return 'deposit_not_allowed'
      const open = typeof parsed.receiver_id === 'string' ? ctx.cashOut?.(parsed.receiver_id) : undefined
      if (!open) return 'receiver_not_allowed'
      if (open.paid) return 'cash_out_paid'
      if (open.expired) return 'cash_out_expired'
      if (parsed.amount !== open.amount) return 'amount_not_allowed'
      return undefined
    }
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

// 1Click's deposit address is a fresh implicit account USDC has no storage for, and a NEP-141 ft_transfer to an
// unregistered account panics (issue #65). The relayer registers it (0.00125 NEAR), but only for a player who holds the
// amount, so nobody can make the relayer pay for registrations with transfers that would fail anyway.
async function registerDeposit(relayer: Relayer, usdc: string, player: string, depositAddress: string, amount: string) {
  if (await relayer.isRegistered(usdc, depositAddress)) return
  if ((await relayer.ftBalance(usdc, player)) < BigInt(amount)) throw new AppError(409, 'not_enough_usdc')
  await relayer.register(usdc, depositAddress)
}

export function relayRoutes(deps: { cfg: Config; db: Db; identity: Identity; relayer?: Relayer; oneclick?: OneClick }) {
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
          cashOut: (addr) => openCashOut(db, user.id, addr),
        })
        if (refused) throw new AppError(403, refused)
        if (!signatureValid(d)) throw new AppError(403, 'bad_signature')
        const call = d.delegateAction.actions[0]!.functionCall!
        const cashOut =
          call.methodName === 'ft_transfer'
            ? (JSON.parse(Buffer.from(call.args).toString('utf8')) as { receiver_id: string; amount: string })
            : undefined
        const cashOutTo = cashOut?.receiver_id
        // Held before sending, so the same deposit can't go out twice. If the relay throws we don't know whether it
        // landed, so the hold stays (the player asks for a new quote); a failure on chain releases it.
        if (cashOutTo && !reserveCashOut(db, user.id, cashOutTo)) throw new AppError(409, 'cash_out_paid')
        if (cashOut && cashOutTo) {
          try {
            await registerDeposit(deps.relayer, cfg.USDC_CONTRACT_ID, user.near_account, cashOutTo, cashOut.amount)
          } catch (e) {
            // Nothing was sent yet: the quote can be paid again.
            releaseCashOut(db, user.id, cashOutTo)
            throw e
          }
        }
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
        if (cashOutTo) {
          if (result.ok) await cashOutPaid(deps, user, cashOutTo, result.hash)
          else releaseCashOut(db, user.id, cashOutTo)
        }
        return c.json(result, result.ok ? 200 : 422)
      },
    )
}

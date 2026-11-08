import {
  Account,
  actions,
  FailoverRpcError,
  FailoverRpcProvider,
  JsonRpcProvider,
  type KeyPairString,
  nearToYocto,
  teraToGas,
} from 'near-api-js'
import { InvalidNonceError } from 'near-api-js/rpc-errors'
import type { Config } from './config.ts'
import type { SignedDelegateWire } from './relay.ts'
import type { Owed, SettleChain } from './settlement.ts'

// Several public RPCs with failover: one free endpoint rate-limits within a few dozen calls, and rpc.*.near.org are
// deprecated (spikes 03, 08).
const RPCS = {
  mainnet: ['https://free.rpc.fastnear.com', 'https://near.drpc.org', 'https://rpc.intea.rs'],
  testnet: ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs'],
} as const

/** When every RPC refused a transaction for its nonce, nothing ran: hand near-api-js the InvalidNonceError itself.
 * Anything else (a timeout on one RPC, then a refusal on the next) stays a FailoverRpcError, because the first RPC may
 * have taken the transaction. */
export function unwrapNonce(e: unknown): unknown {
  if (e instanceof FailoverRpcError && e.errors.length > 0 && e.errors.every((x) => x instanceof InvalidNonceError))
    return e.errors[0]
  return e
}

// near-api-js keeps each Account's next nonce in memory and refreshes it only on an InvalidNonceError, but the failover
// provider wraps every error, so a nonce taken by anything else signing with the key (another Account object, another
// process, the CLI) failed every transaction after it. With the error unwrapped, near-api-js re-reads the nonce and
// signs again (a rejected nonce means the transaction never ran, so this can't send twice).
export class NonceRetryProvider extends FailoverRpcProvider {
  override async sendTransactionUntil(...args: Parameters<FailoverRpcProvider['sendTransactionUntil']>) {
    try {
      return await super.sendTransactionUntil(...args)
    } catch (e) {
      throw unwrapNonce(e)
    }
  }
}

// Every signing account uses it: the relayer and the owner may be one account (config.ts), each with its own Account
// object, and the warehouse's MPC requests and deposits share a key too.
export function nearProvider(network: Config['NEAR_NETWORK']) {
  return new NonceRetryProvider(RPCS[network].map((url) => new JsonRpcProvider({ url })))
}

export type RelayResult = { hash: string; ok: boolean; error?: string }

// Everything the api does on NEAR with the relayer's key. A fake in tests.
export type Relayer = {
  relay(signed: SignedDelegateWire): Promise<RelayResult>
  accountExists(accountId: string): Promise<boolean>
  createImplicit(accountId: string): Promise<string>
  isRegistered(tokenId: string, accountId: string): Promise<boolean>
  register(tokenId: string, accountId: string): Promise<string>
  // A NEP-141 balance in the token's smallest unit, and an ft_transfer from the relayer (testnet faucet).
  ftBalance(tokenId: string, accountId: string): Promise<bigint>
  ftTransfer(tokenId: string, receiverId: string, amount: bigint, memo: string): Promise<RelayResult>
}

type Outcome = {
  transaction: { hash: string }
  status: unknown
  receipts_outcome?: { outcome: { status: unknown; logs?: string[] } }[]
}

// The contract refunds a refused drink inside a successful ft_transfer_call; only its `refund` event (NEP-297) says so.
function refundReason(o: Outcome): string | undefined {
  for (const log of (o.receipts_outcome ?? []).flatMap((r) => r.outcome.logs ?? [])) {
    if (!log.startsWith('EVENT_JSON:')) continue
    try {
      const e = JSON.parse(log.slice('EVENT_JSON:'.length)) as {
        standard?: string
        event?: string
        data?: { reason?: string }[]
      }
      if (e.standard === 'nyxeron' && e.event === 'refund') return e.data?.[0]?.reason ?? 'unknown'
    } catch {
      // Another contract's malformed log: not ours.
    }
  }
}

export function summarise(o: Outcome): RelayResult {
  const failure = [o.status, ...(o.receipts_outcome ?? []).map((r) => r.outcome.status)].find((s) =>
    JSON.stringify(s ?? '').includes('Failure'),
  )
  if (failure) return { hash: o.transaction.hash, ok: false, error: JSON.stringify(failure).slice(0, 500) }
  const refund = refundReason(o)
  return refund
    ? { hash: o.transaction.hash, ok: false, error: `refund:${refund}` }
    : { hash: o.transaction.hash, ok: true }
}

export function nearRelayer(cfg: Config): Relayer | undefined {
  if (!cfg.RELAYER_ACCOUNT_ID || !cfg.RELAYER_KEY) return undefined
  const provider = nearProvider(cfg.NEAR_NETWORK)
  const relayer = new Account(cfg.RELAYER_ACCOUNT_ID, provider, cfg.RELAYER_KEY as KeyPairString)
  return {
    async relay(signed) {
      return summarise((await relayer.relayMetaTransaction(signed as never)) as unknown as Outcome)
    },
    async accountExists(accountId) {
      return provider.viewAccount({ accountId }).then(
        () => true,
        () => false,
      )
    },
    async createImplicit(accountId) {
      // A 0 NEAR transfer creates an implicit account (≈ 0.0071 NEAR burned, spike 04).
      const o = (await relayer.transfer({ receiverId: accountId, amount: 0n })) as unknown as Outcome
      return o.transaction.hash
    },
    async isRegistered(tokenId, accountId) {
      const balance = await provider.callFunction({
        contractId: tokenId,
        method: 'storage_balance_of',
        args: { account_id: accountId },
      })
      return balance !== null && balance !== undefined
    },
    async register(tokenId, accountId) {
      // signAndSendTransaction, not callFunction: callFunction returns the method's value and drops the tx hash.
      const o = (await relayer.signAndSendTransaction({
        receiverId: tokenId,
        actions: [
          actions.functionCall(
            'storage_deposit',
            { account_id: accountId, registration_only: true },
            teraToGas('30'),
            nearToYocto('0.00125'),
          ),
        ],
      })) as unknown as Outcome
      return o.transaction.hash
    },
    async ftBalance(tokenId, accountId) {
      const raw = await provider.callFunction<string>({
        contractId: tokenId,
        method: 'ft_balance_of',
        args: { account_id: accountId },
      })
      return BigInt(raw ?? 0)
    },
    async ftTransfer(tokenId, receiverId, amount, memo) {
      const o = (await relayer.signAndSendTransaction({
        receiverId: tokenId,
        actions: [
          actions.functionCall(
            'ft_transfer',
            { receiver_id: receiverId, amount: amount.toString(), memo },
            teraToGas('30'),
            1n,
          ),
        ],
      })) as unknown as Outcome
      return summarise(o)
    },
  }
}

// The contract owner's calls for settlement (release, mint, settle) and the views it checks before each one.
export function nearOwnerChain(cfg: Config): SettleChain | undefined {
  if (!cfg.OWNER_ACCOUNT_ID || !cfg.OWNER_KEY) return undefined
  const provider = nearProvider(cfg.NEAR_NETWORK)
  const owner = new Account(cfg.OWNER_ACCOUNT_ID, provider, cfg.OWNER_KEY as KeyPairString)
  const contractId = cfg.CONTRACT_ID
  const call = async (method: string, args: object, tgas: number) => {
    const o = (await owner.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.functionCall(method, args, teraToGas(tgas), 0n)],
    })) as unknown as Outcome
    const r = summarise(o)
    if (!r.ok) throw new Error(`${method} failed in ${r.hash}: ${r.error}`)
    return r.hash
  }
  const view = async <T>(method: string, args: Record<string, unknown>): Promise<T> =>
    (await provider.callFunction({ contractId, method, args })) as T
  return {
    release: (party) => call('release_wholesale', { party }, 100),
    mint: (token, units, proof) => call('mint_warehouse', { token_id: token, amount: units.toString(), proof }, 50),
    // 32 transfers fit in one call (the contract's sandbox test settle_max_batch_fits).
    settle: (party, opId, transfers) => call('settle', { party, op_id: opId, transfers }, 300),
    owed: (party) => view<Owed[]>('owed', { party }),
    pot: (party) => view<{ held: string; released: boolean }>('party_pot', { party }),
    isUsedProof: (proof) => view<boolean>('is_used_proof', { proof }),
    isSettled: (opId) => view<boolean>('is_settled', { op_id: opId }),
  }
}

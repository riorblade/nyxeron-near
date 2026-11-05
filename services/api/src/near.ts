import {
  Account,
  actions,
  FailoverRpcProvider,
  JsonRpcProvider,
  type KeyPairString,
  nearToYocto,
  teraToGas,
} from 'near-api-js'
import type { Config } from './config.ts'
import type { SignedDelegateWire } from './relay.ts'

// Several public RPCs with failover: one free endpoint rate-limits within a few dozen calls, and rpc.*.near.org are
// deprecated (spikes 03, 08).
const RPCS = {
  mainnet: ['https://free.rpc.fastnear.com', 'https://near.drpc.org', 'https://rpc.intea.rs'],
  testnet: ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs'],
} as const

export function nearProvider(network: Config['NEAR_NETWORK']) {
  return new FailoverRpcProvider(RPCS[network].map((url) => new JsonRpcProvider({ url })))
}

export type RelayResult = { hash: string; ok: boolean; error?: string }

// Everything the api does on NEAR with the relayer's key. A fake in tests.
export type Relayer = {
  relay(signed: SignedDelegateWire): Promise<RelayResult>
  accountExists(accountId: string): Promise<boolean>
  createImplicit(accountId: string): Promise<string>
  isRegistered(tokenId: string, accountId: string): Promise<boolean>
  register(tokenId: string, accountId: string): Promise<string>
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
  }
}

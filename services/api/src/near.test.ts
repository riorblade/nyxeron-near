import {
  Account,
  actions,
  FailoverRpcError,
  FailoverRpcProvider,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  type SignedTransaction,
} from 'near-api-js'
import { InvalidNonceError } from 'near-api-js/rpc-errors'
import { describe, expect, it, vi } from 'vitest'
import { nearProvider, NonceRetryProvider, summarise, unwrapNonce } from './near.ts'

const ok = { SuccessValue: '' }
const tx = (logs: string[], status: unknown = ok) => ({
  transaction: { hash: 'h' },
  status: ok,
  receipts_outcome: [{ outcome: { status, logs } }],
})
const event = (e: object) => `EVENT_JSON:${JSON.stringify({ standard: 'nyxeron', version: '1.0.0', ...e })}`

describe('summarise a relayed transaction', () => {
  it('a purchase the contract accepted is ok', () => {
    expect(summarise(tx([event({ event: 'purchase', data: [{}] })]))).toEqual({ hash: 'h', ok: true })
  })

  it('a purchase the contract refunded is not, with its reason', () => {
    const refunded = tx([event({ event: 'refund', data: [{ sender_id: 'a', amount: '1', reason: 'expired' }] })])
    expect(summarise(refunded)).toEqual({ hash: 'h', ok: false, error: 'refund:expired' })
  })

  it('ignores other contracts and malformed logs; a failed receipt still fails', () => {
    const noise = ['EVENT_JSON:{bad', `EVENT_JSON:${JSON.stringify({ standard: 'nep141', event: 'refund', data: [] })}`]
    expect(summarise(tx(noise))).toEqual({ hash: 'h', ok: true })
    expect(summarise(tx([], { Failure: { x: 1 } })).ok).toBe(false)
  })
})

// near-api-js's own Account against fake RPCs: what a nonce taken by another signer of the same key does.
describe('a key’s nonce taken by another signer', () => {
  class FakeRpc extends JsonRpcProvider {
    chain: { nonce: bigint; sent: bigint[]; down?: boolean }
    constructor(chain: { nonce: bigint; sent: bigint[]; down?: boolean }) {
      super({ url: 'http://fake' })
      this.chain = chain
    }
    override async viewAccessKey() {
      return { nonce: this.chain.nonce, permission: 'FullAccess', block_height: 1, block_hash: '1'.repeat(32) } as never
    }
    override async viewBlock() {
      return { header: { hash: '1'.repeat(32), height: 1 } } as never
    }
    override async sendTransactionUntil(tx: SignedTransaction) {
      if (this.chain.down) throw new Error('timeout')
      const n = BigInt(tx.transaction.nonce)
      if (n <= this.chain.nonce) throw new InvalidNonceError(Number(this.chain.nonce), Number(n), 'h', 'b')
      this.chain.nonce = n
      this.chain.sent.push(n)
      return {
        status: { SuccessValue: '' },
        transaction: { hash: `tx${n}` },
        transaction_outcome: { id: 'x' },
        receipts_outcome: [],
      } as never
    }
  }
  const key = KeyPair.fromRandom('ed25519').toString()
  const send = (a: Account) => a.signAndSendTransaction({ receiverId: 'usdc.near', actions: [actions.transfer(1n)] })

  it('re-reads a nonce another signer took, instead of failing every transaction after it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const Provider of [FailoverRpcProvider, NonceRetryProvider]) {
      const chain = { nonce: 100n, sent: [] as bigint[] }
      const rpcs = () => new Provider([new FakeRpc(chain), new FakeRpc(chain), new FakeRpc(chain)])
      const ours = new Account('w.near', rpcs(), key as KeyPairString)
      const other = new Account('w.near', rpcs(), key as KeyPairString)
      await send(ours)
      await send(other) // takes the nonce `ours` has cached next
      const third = send(ours)
      if (Provider === NonceRetryProvider) {
        expect((await third).transaction.hash).toBe('tx103')
        expect(chain.sent).toEqual([101n, 102n, 103n])
      } else await expect(third).rejects.toBeInstanceOf(FailoverRpcError) // near-api-js alone: stuck on a stale nonce
    }
  })

  it('is what every signing account gets: relayer, owner (maybe the same account) and warehouse', () => {
    expect(nearProvider('mainnet')).toBeInstanceOf(NonceRetryProvider)
    expect(nearProvider('testnet')).toBeInstanceOf(NonceRetryProvider)
  })

  it('keeps a failure ambiguous when one RPC may have taken the transaction', () => {
    const nonce = new InvalidNonceError(1, 1, 'h', 'b')
    const mixed = new FailoverRpcError(2, [new Error('timeout'), nonce])
    expect(unwrapNonce(mixed)).toBe(mixed)
    expect(unwrapNonce(new FailoverRpcError(2, [nonce, nonce]))).toBe(nonce)
    expect(unwrapNonce(new FailoverRpcError(0, []))).toBeInstanceOf(FailoverRpcError)
  })
})

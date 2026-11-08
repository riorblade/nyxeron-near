import { createHash } from 'node:crypto'
import {
  Account,
  actions,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  keyToImplicitAddress,
  type SignedTransaction,
} from 'near-api-js'
import { describe, expect, it } from 'vitest'
import { relayerOn, summarise } from './near.ts'
import { decodeDelegate } from './relay.ts'

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

// The relayer on near-api-js's own Account, against a fake RPC that answers like testnet did.
describe('the relayer’s transactions', () => {
  // An expired delegate (testnet k8UMQ4…): the transaction lands, its Delegate receipt fails, so the top-level status
  // is a Failure too. near-api-js throws on that by default, which the relay route reads as "unknown".
  const expired = { Failure: { ActionError: { index: 0, kind: 'DelegateActionExpired' } } }
  class FakeRpc extends JsonRpcProvider {
    sent: SignedTransaction[] = []
    status: unknown = ok
    constructor() {
      super({ url: 'http://fake' })
    }
    override async viewAccessKey() {
      return { nonce: 1n, permission: 'FullAccess', block_height: 1, block_hash: '1'.repeat(32) } as never
    }
    override async viewBlock() {
      return { header: { hash: '1'.repeat(32), height: 1 } } as never
    }
    override async sendTransactionUntil(t: SignedTransaction) {
      this.sent.push(t)
      return {
        status: this.status,
        transaction: { hash: 'tx-relay' },
        transaction_outcome: { id: 'tx-relay', block_hash: '1'.repeat(32), outcome: { receipt_ids: ['r1'] } },
        receipts_outcome: [{ id: 'r1', outcome: { status: this.status, logs: [] } }],
      } as never
    }
  }
  const setup = () => {
    const rpc = new FakeRpc()
    const account = new Account('relayer.near', rpc, KeyPair.fromRandom('ed25519').toString() as KeyPairString)
    return { rpc, relayer: relayerOn(account) }
  }
  const player = KeyPair.fromRandom('ed25519')
  const signed = () => {
    const delegateAction = buildDelegateAction({
      senderId: keyToImplicitAddress(player.getPublicKey()),
      receiverId: 'usdc.near',
      nonce: 1n,
      maxBlockHeight: 1_000n,
      publicKey: player.getPublicKey(),
      actions: [
        actions.functionCall('ft_transfer', { receiver_id: 'ab'.repeat(32), amount: '5' }, 30n * 10n ** 12n, 1n),
      ],
    })
    const hash = createHash('sha256').update(encodeDelegateAction(delegateAction)).digest()
    const signature = { ed25519Signature: { data: player.sign(hash).signature } }
    return decodeDelegate(Buffer.from(encodeSignedDelegate({ delegateAction, signature } as never)).toString('base64'))
  }

  it('relays the delegate to its sender in one transaction', async () => {
    const t = setup()
    const d = signed()
    expect(await t.relayer.relay(d)).toEqual({ hash: 'tx-relay', ok: true })
    const sent = t.rpc.sent[0]!.transaction
    expect(sent.receiverId).toBe(d.delegateAction.senderId)
    expect(sent.actions).toHaveLength(1)
    expect(sent.actions[0]!.signedDelegate?.delegateAction.receiverId).toBe('usdc.near')
  })

  it('a delegate that failed on chain comes back with its hash, not as a throw', async () => {
    const t = setup()
    t.rpc.status = expired
    expect(await t.relayer.relay(signed())).toMatchObject({ hash: 'tx-relay', ok: false })
  })

  it('so does a transfer of its own that failed on chain', async () => {
    const t = setup()
    t.rpc.status = expired
    expect(await t.relayer.ftTransfer('usdc.near', 'bob.near', 5n, 'm')).toMatchObject({ hash: 'tx-relay', ok: false })
  })
})

import { createHash } from 'node:crypto'
import {
  Account,
  actions,
  baseEncode,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  encodeTransaction,
  FailoverRpcError,
  FailoverRpcProvider,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  keyToImplicitAddress,
  type SignedTransaction,
} from 'near-api-js'
import { InvalidNonceError, UnknownTransactionError } from 'near-api-js/rpc-errors'
import { describe, expect, it, vi } from 'vitest'
import { freshDepositsOnly, nearTreasury } from './fund.ts'
import { type MayResign, nearProvider, NonceRetryProvider, relayerOn, summarise, unwrapNonce } from './near.ts'
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

// near-api-js's own Account against fake RPCs: what a nonce taken by another signer of the same key does.
describe('a key’s nonce taken by another signer', () => {
  type Chain = {
    nonce: bigint
    sent: bigint[]
    landed: Map<string, bigint>
    usdc: Map<string, bigint> // ft_transfer'd USDC per receiver
    down?: boolean
    lostAnswer?: boolean
    unindexed?: boolean // landed, but no RPC knows its hash yet
  }
  const newChain = (): Chain => ({ nonce: 100n, sent: [], landed: new Map(), usdc: new Map() })
  const hashOf = (tx: SignedTransaction) =>
    baseEncode(createHash('sha256').update(encodeTransaction(tx.transaction)).digest())
  const outcome = (hash: string) =>
    ({
      status: { SuccessValue: '' },
      transaction: { hash },
      transaction_outcome: { id: hash, outcome: { receipt_ids: [`r-${hash}`] } },
      receipts_outcome: [{ id: `r-${hash}`, outcome: { status: { SuccessValue: '' }, logs: [] } }],
    }) as never
  class FakeRpc extends JsonRpcProvider {
    chain: Chain
    constructor(chain: Chain) {
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
      this.chain.landed.set(hashOf(tx), n)
      for (const a of tx.transaction.actions) {
        if (a.functionCall?.methodName !== 'ft_transfer') continue
        const { receiver_id, amount } = JSON.parse(Buffer.from(a.functionCall.args).toString())
        this.chain.usdc.set(receiver_id, (this.chain.usdc.get(receiver_id) ?? 0n) + BigInt(amount))
      }
      // It ran, but the answer was lost and the resend was refused for its nonce (an RPC that doesn't look it up).
      if (this.chain.lostAnswer) throw new InvalidNonceError(Number(n), Number(n), 'h', 'b')
      return outcome(hashOf(tx))
    }
    override async callFunction(q: Parameters<JsonRpcProvider['callFunction']>[0]) {
      const { method, args } = q as { method: string; args: Record<string, unknown> }
      if (method === 'ft_balance_of') return String(this.chain.usdc.get(args.account_id as string) ?? 0n) as never
      if (method === 'storage_balance_of') return null as never
      throw new Error(`no view ${method}`)
    }
    // Like the real RPCs: an unknown hash is UNKNOWN_TRANSACTION only with wait_until NONE; any other wait times out.
    override async viewTransactionStatus({ txHash, waitUntil }: { txHash: string | Uint8Array; waitUntil?: string }) {
      if (this.chain.down) throw new Error('timeout')
      if (this.chain.landed.has(txHash as string) && !this.chain.unindexed) return outcome(txHash as string)
      if (waitUntil === 'NONE') throw new UnknownTransactionError(txHash as string)
      throw new Error('timeout')
    }
  }
  const key = KeyPair.fromRandom('ed25519').toString()
  // A different amount per signer: two signers' transactions with the same nonce would otherwise be the same bytes.
  const send = (a: Account, amount = 1n) =>
    a.signAndSendTransaction({ receiverId: 'usdc.near', actions: [actions.transfer(amount)] })
  const accounts = (
    chain: Chain,
    Provider: typeof FailoverRpcProvider = NonceRetryProvider,
    opts: { mayResign?: MayResign } = {},
  ) => {
    const rpcs = () =>
      Provider === NonceRetryProvider
        ? new NonceRetryProvider([new FakeRpc(chain), new FakeRpc(chain), new FakeRpc(chain)], opts)
        : new Provider([new FakeRpc(chain), new FakeRpc(chain), new FakeRpc(chain)])
    return [new Account('w.near', rpcs(), key as KeyPairString), new Account('w.near', rpcs(), key as KeyPairString)]
  }

  it('re-reads a nonce another signer took, instead of failing every transaction after it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const Provider of [FailoverRpcProvider, NonceRetryProvider]) {
      const chain = newChain()
      const [ours, other] = accounts(chain, Provider)
      await send(ours!)
      await send(other!, 2n) // takes the nonce `ours` has cached next
      const third = send(ours!)
      if (Provider === NonceRetryProvider) {
        expect((await third).transaction.hash).toBe([...chain.landed.keys()][2])
        expect(chain.sent).toEqual([101n, 102n, 103n])
      } else await expect(third).rejects.toBeInstanceOf(FailoverRpcError) // near-api-js alone: stuck on a stale nonce
    }
  })

  it('never signs again a transaction that ran: its refused resend answers with the landed outcome', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const chain = newChain()
    chain.lostAnswer = true
    const [ours] = accounts(chain)
    const r = await send(ours!)
    expect(chain.sent).toEqual([101n])
    expect(r.transaction.hash).toBe([...chain.landed.keys()][0])
  })

  const lookupFailures = [
    ['every RPC timed out', [new Error('timeout')]],
    ['one RPC didn’t know it, another timed out', [new UnknownTransactionError('h'), new Error('timeout')]],
  ] as const
  for (const [what, errors] of lookupFailures) {
    it(`stays "may have landed" when the lookup fails: ${what}`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const chain = newChain()
      const [ours, other] = accounts(chain)
      await send(other!, 2n)
      await send(ours!) // ours caches 103; other takes it next
      await send(other!, 2n)
      const rpcs = ours!.provider as NonceRetryProvider
      vi.spyOn(rpcs, 'viewTransactionStatus').mockRejectedValue(new FailoverRpcError(errors.length, [...errors]))
      await expect(send(ours!)).rejects.toBeInstanceOf(FailoverRpcError)
      expect(chain.sent).toEqual([101n, 102n, 103n])
    })
  }

  it('an answer for another transaction is not taken for this one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const chain = newChain()
    chain.lostAnswer = true
    const [ours] = accounts(chain)
    const rpcs = ours!.provider as NonceRetryProvider
    const view = rpcs.viewTransactionStatus.bind(rpcs)
    vi.spyOn(rpcs, 'viewTransactionStatus').mockImplementation(async (q) => {
      const o = (await view(q)) as { transaction: { hash: string } }
      return { ...o, transaction: { hash: 'someone-else' } } as never
    })
    await expect(send(ours!)).rejects.toBeInstanceOf(FailoverRpcError)
    expect(chain.sent).toEqual([101n])
  })

  describe('a treasury deposit (fund.ts)', () => {
    const USDC = 'usdc.near'
    const DEP = 'ab'.repeat(32) // a fresh 1Click deposit address
    const treasuryOf = (chain: Chain, guarded: boolean) => {
      const [account] = accounts(chain, NonceRetryProvider, guarded ? { mayResign: freshDepositsOnly(USDC) } : {})
      return nearTreasury({ account: account!, usdcId: USDC })
    }

    it('that landed but no RPC has indexed yet is never sent again', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      for (const guarded of [false, true]) {
        const chain = newChain()
        chain.lostAnswer = true
        chain.unindexed = true
        const sent = treasuryOf(chain, guarded).deposit(DEP, 5_000_000n, false)
        if (guarded) {
          await expect(sent).rejects.toBeInstanceOf(FailoverRpcError) // fund.ts: stuck as deposit_unknown
          expect(chain.usdc.get(DEP)).toBe(5_000_000n)
        } else {
          // without the guard: unknown everywhere looks like "never ran", so it is signed again, and again
          await sent.catch(() => {})
          expect(chain.usdc.get(DEP)).toBeGreaterThan(5_000_000n)
        }
      }
    })

    it('whose nonce another signer took (the address holds nothing) is signed again and lands once', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const chain = newChain()
      const treasury = treasuryOf(chain, true)
      const [other] = accounts(chain)
      await treasury.deposit(DEP, 1n, false) // caches the next nonce
      await send(other!, 2n) // takes it
      expect(await treasury.deposit('cd'.repeat(32), 5_000_000n, false)).toMatchObject({ ok: true })
      expect(chain.usdc.get('cd'.repeat(32))).toBe(5_000_000n)
    })
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

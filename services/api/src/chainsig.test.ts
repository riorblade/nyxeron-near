import {
  Account,
  actions,
  baseEncode,
  FailoverRpcError,
  FailoverRpcProvider,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  type SignedTransaction,
} from 'near-api-js'
import { InvalidNonceError } from 'near-api-js/rpc-errors'
import {
  encodeFunctionData,
  erc20Abi,
  type Hex,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerializableEIP1559,
} from 'viem'
import { privateKeyToAccount, sign } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'
import {
  type EvmChain,
  KYBER_ROUTER,
  type Mpc,
  NonceRetryProvider,
  parseMpcSignature,
  SECP256K1_N,
  unwrapNonce,
  USDG,
  warehouse,
} from './chainsig.ts'

const KEY = `0x${'11'.repeat(32)}` as Hex
const OTHER_KEY = `0x${'22'.repeat(32)}` as Hex
const me = privateKeyToAccount(KEY)

// The MPC's derived key for (account, path) is `secp256k1:<base58 of x‖y>`; here it is our test key's.
const derivedKey = (privateKey: Hex) =>
  `secp256k1:${baseEncode(Buffer.from(privateKeyToAccount(privateKey).publicKey.slice(4), 'hex'))}`

// A fake MPC that signs with `key` and answers in one of its two shapes.
function fakeMpc(opts: { key?: Hex; shape?: 'flat' | 'wrapped'; highS?: boolean } = {}) {
  const requests: Hex[] = []
  const mpc: Mpc = {
    async derivedPublicKey() {
      return derivedKey(KEY)
    },
    async sign(hash) {
      requests.push(hash)
      const sig = await sign({ hash, privateKey: opts.key ?? KEY })
      let s = BigInt(sig.s)
      let y = sig.yParity
      if (opts.highS) {
        s = SECP256K1_N - s
        y = y === 0 ? 1 : 0
      }
      const ecdsa = {
        big_r: { affine_point: `${y === 0 ? '02' : '03'}${sig.r.slice(2)}`.toUpperCase() },
        s: { scalar: s.toString(16).padStart(64, '0').toUpperCase() },
        recovery_id: y,
      }
      return opts.shape === 'wrapped' ? { Secp256k1: ecdsa } : { scheme: 'Secp256k1', ...ecdsa }
    },
  }
  return { mpc, requests }
}

function fakeChain(opts: { status?: 'success' | 'reverted'; nonce?: number } = {}) {
  const sent: Hex[] = []
  const chain: EvmChain = {
    async getTransactionCount() {
      return opts.nonce ?? 7
    },
    async sendRawTransaction(raw) {
      sent.push(raw)
      return `0x${'ab'.repeat(32)}` as Hex
    },
    async waitForReceipt(hash) {
      return { transactionHash: hash, status: opts.status ?? 'success', blockNumber: 100n }
    },
  }
  return { chain, sent }
}

const limits = { maxGas: 1_000_000n, maxFeePerGas: 1_000_000_000n }

function setup(mpcOpts = {}, chainOpts = {}) {
  const m = fakeMpc(mpcOpts)
  const c = fakeChain(chainOpts)
  return { ...m, ...c, w: warehouse({ mpc: m.mpc, chain: c.chain, limits }) }
}

const swap = (over: Partial<TransactionSerializableEIP1559> = {}): TransactionSerializableEIP1559 => ({
  type: 'eip1559',
  chainId: 4663,
  to: KYBER_ROUTER,
  data: '0xe21fd0e9',
  value: 0n,
  gas: 800_000n,
  maxFeePerGas: 100_000_000n,
  maxPriorityFeePerGas: 0n,
  ...over,
})

const approve = (spender: Hex) =>
  swap({
    to: USDG,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, 5_000_000n] }),
    gas: 60_000n,
  })

describe('warehouse address', () => {
  it('is the address of the key the MPC derives', async () => {
    expect(await setup().w.address()).toBe(me.address)
  })
})

describe('checks before paying for a sign request', () => {
  const refused: [string, TransactionSerializableEIP1559, string][] = [
    ['another chain', swap({ chainId: 1 }), 'wrong_chain'],
    ['an unknown target', swap({ to: `0x${'99'.repeat(20)}` }), 'wrong_target'],
    ['no target', swap({ to: undefined }), 'wrong_target'],
    ['sending ETH', swap({ value: 1n }), 'value_not_zero'],
    ['too much gas', swap({ gas: limits.maxGas + 1n }), 'gas_too_high'],
    ['no gas limit', swap({ gas: undefined }), 'gas_too_high'],
    ['too high a fee', swap({ maxFeePerGas: limits.maxFeePerGas + 1n }), 'fee_too_high'],
    ['a tip above the fee', swap({ maxPriorityFeePerGas: 200_000_000n }), 'fee_too_high'],
    ['an approve for someone else', approve(`0x${'99'.repeat(20)}`), 'wrong_target'],
    ['another call on the token', swap({ to: USDG, data: '0xa9059cbb' }), 'wrong_target'],
  ]
  for (const [what, tx, code] of refused) {
    it(`refuses ${what} (${code}) without asking the MPC`, async () => {
      const { w, requests, sent } = setup()
      await expect(w.signAndSend(tx)).rejects.toMatchObject({ code })
      expect(requests).toEqual([])
      expect(sent).toEqual([])
    })
  }

  it('refuses a legacy transaction', async () => {
    const { w, requests } = setup()
    await expect(w.signAndSend({ ...swap(), type: 'legacy' } as never)).rejects.toMatchObject({ code: 'not_eip1559' })
    expect(requests).toEqual([])
  })
})

describe('signing', () => {
  for (const shape of ['flat', 'wrapped'] as const) {
    it(`a swap on the router, ${shape} MPC answer: signed by the warehouse, sent, receipt checked`, async () => {
      const { w, requests, sent } = setup({ shape })
      const res = await w.signAndSend(swap())
      expect(requests).toHaveLength(1)
      expect(sent).toHaveLength(1)
      const raw = sent[0] as `0x02${string}`
      expect(await recoverTransactionAddress({ serializedTransaction: raw })).toBe(me.address)
      const tx = parseTransaction(raw)
      expect(tx.nonce).toBe(7) // filled in from the chain
      expect(tx.to?.toLowerCase()).toBe(KYBER_ROUTER.toLowerCase())
      expect(res).toEqual({ hash: `0x${'ab'.repeat(32)}`, blockNumber: 100n })
    })
  }

  it('an approve of USDG for the router is allowed', async () => {
    const { w, sent } = setup()
    await w.signAndSend(approve(KYBER_ROUTER))
    expect(sent).toHaveLength(1)
  })

  it('a high-s answer is made low-s (EIP-2) and still recovers to the warehouse', async () => {
    const { w, sent } = setup({ highS: true })
    await w.signAndSend(swap())
    const tx = parseTransaction(sent[0] as `0x02${string}`)
    expect(BigInt(tx.s!)).toBeLessThanOrEqual(SECP256K1_N / 2n)
    expect(await recoverTransactionAddress({ serializedTransaction: sent[0] as `0x02${string}` })).toBe(me.address)
  })

  it('a signature from another key is never broadcast', async () => {
    const { w, sent } = setup({ key: OTHER_KEY })
    await expect(w.signAndSend(swap())).rejects.toMatchObject({ code: 'wrong_signer' })
    expect(sent).toEqual([])
  })

  it('a reverted transaction is an error that carries its hash', async () => {
    const { w } = setup({}, { status: 'reverted' })
    await expect(w.signAndSend(swap())).rejects.toMatchObject({ code: 'reverted', hash: `0x${'ab'.repeat(32)}` })
  })

  it('keeps an explicit nonce', async () => {
    const { w, sent } = setup()
    await w.signAndSend(swap({ nonce: 3 }))
    expect(parseTransaction(sent[0] as `0x02${string}`).nonce).toBe(3)
  })
})

describe('MPC answers', () => {
  const r = 'a'.repeat(64)
  const s = '0'.repeat(63) + '1'
  it('reads both shapes', () => {
    const ecdsa = { big_r: { affine_point: `02${r}` }, s: { scalar: s }, recovery_id: 1 }
    const want = { r: `0x${r}`, s: `0x${s}`, yParity: 1 }
    expect(parseMpcSignature({ scheme: 'Secp256k1', ...ecdsa })).toEqual(want)
    expect(parseMpcSignature({ Secp256k1: ecdsa })).toEqual(want)
  })

  const bad: [string, unknown][] = [
    ['nothing', null],
    ['an Ed25519 answer', { scheme: 'Ed25519', signature: [1, 2] }],
    ['a short R', { big_r: { affine_point: `02${r.slice(2)}` }, s: { scalar: s }, recovery_id: 0 }],
    ['an uncompressed R', { big_r: { affine_point: `04${r}` }, s: { scalar: s }, recovery_id: 0 }],
    ['a non-hex s', { big_r: { affine_point: `02${r}` }, s: { scalar: 'z'.repeat(64) }, recovery_id: 0 }],
    ['recovery id 2', { big_r: { affine_point: `02${r}` }, s: { scalar: s }, recovery_id: 2 }],
  ]
  for (const [what, answer] of bad) {
    it(`refuses ${what}`, () => {
      expect(() => parseMpcSignature(answer)).toThrow(expect.objectContaining({ code: 'bad_mpc_answer' }))
    })
  }
})

// near-api-js's own Account against fake RPCs: what a nonce taken by another signer of the same key does.
describe('the warehouse account’s nonce', () => {
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

  it('keeps a failure ambiguous when one RPC may have taken the transaction', () => {
    const nonce = new InvalidNonceError(1, 1, 'h', 'b')
    const mixed = new FailoverRpcError(2, [new Error('timeout'), nonce])
    expect(unwrapNonce(mixed)).toBe(mixed)
    expect(unwrapNonce(new FailoverRpcError(2, [nonce, nonce]))).toBe(nonce)
    expect(unwrapNonce(new FailoverRpcError(0, []))).toBeInstanceOf(FailoverRpcError)
  })
})

// The warehouse on Robinhood Chain: an EVM address that NEAR Chain Signatures controls for the api's NEAR account.
// There is no private key for it anywhere. Every transaction is checked here before we pay for a sign request, and the
// signature is checked before anything is broadcast (spike 16, SPEC §5.3).
import { Account, type KeyPairString, PublicKey, teraToGas } from 'near-api-js'
import {
  type Address,
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  fallback,
  type Hex,
  http,
  isAddressEqual,
  keccak256,
  recoverTransactionAddress,
  serializeTransaction,
  type TransactionSerializableEIP1559,
} from 'viem'
import { publicKeyToAddress } from 'viem/accounts'
import type { Config } from './config.ts'
import { nearProvider } from './near.ts'
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_RPCS } from './robinhood.ts'

export const WAREHOUSE_PATH = 'nyxeron-warehouse-hood'
const DOMAIN_SECP256K1 = 0
export const MPC_BY_NETWORK = { testnet: 'v1.signer-prod.testnet', mainnet: 'v1.signer' } as const

// KyberSwap's router on Robinhood Chain (its /routes answer, 2026-11-05) and Robinhood's USDG, what we pay with.
export const KYBER_ROUTER: Address = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'
export const USDG: Address = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

// maxApprove: the most USDG (6 decimals) the router may be allowed to pull, one swap's worth (SPEC §5.3: $50).
export type Limits = { maxGas: bigint; maxFeePerGas: bigint; maxApprove?: bigint }
// Gas price was ≈ 0.02 gwei on 2026-11-05; 0.2 gwei × 1.5M gas caps one transaction at 0.0003 ETH.
export const DEFAULT_LIMITS: Limits = { maxGas: 1_500_000n, maxFeePerGas: 200_000_000n, maxApprove: 50_000_000n }

export class ChainsigError extends Error {
  readonly code: string
  readonly hash?: Hex
  constructor(code: string, message: string, hash?: Hex) {
    super(`${code}: ${message}`)
    this.code = code
    this.hash = hash
  }
}

// What we need from the MPC contract. A fake in tests.
export type Mpc = {
  // `secp256k1:<base58 of the 64-byte x‖y key>` for our account + path.
  derivedPublicKey(path: string): Promise<string>
  // Signs a 32-byte hash; returns the contract's answer as is.
  sign(hash: Hex, path: string): Promise<unknown>
}

// What we need from Robinhood Chain. A fake in tests.
export type EvmChain = {
  getTransactionCount(address: Address): Promise<number>
  sendRawTransaction(raw: Hex): Promise<Hex>
  waitForReceipt(hash: Hex): Promise<{ transactionHash: Hex; status: 'success' | 'reverted'; blockNumber: bigint }>
}

type Ecdsa = { big_r: { affine_point: string }; s: { scalar: string }; recovery_id: number }

// The MPC answers `{ scheme, big_r, s, recovery_id }` today; the docs show `{ Secp256k1: { big_r, s, recovery_id } }`.
export function parseMpcSignature(answer: unknown): { r: Hex; s: Hex; yParity: 0 | 1 } {
  const bad = (why: string) => new ChainsigError('bad_mpc_answer', why)
  if (!answer || typeof answer !== 'object') throw bad('not an object')
  const ecdsa = ('Secp256k1' in answer ? answer.Secp256k1 : answer) as Partial<Ecdsa>
  const point = ecdsa?.big_r?.affine_point
  const scalar = ecdsa?.s?.scalar
  const y = ecdsa?.recovery_id
  // R is a compressed point: 02/03 then its x coordinate, which is r.
  if (typeof point !== 'string' || !/^0[23][0-9a-fA-F]{64}$/.test(point)) throw bad('big_r is not a compressed point')
  if (typeof scalar !== 'string' || !/^[0-9a-fA-F]{64}$/.test(scalar)) throw bad('s is not 32 bytes of hex')
  if (y !== 0 && y !== 1) throw bad('recovery_id is not 0 or 1')
  return { r: `0x${point.slice(2).toLowerCase()}`, s: `0x${scalar.toLowerCase()}`, yParity: y }
}

// EIP-2: nodes refuse s above n/2. (r, n − s) with the other parity is the same signature.
function lowS(sig: { r: Hex; s: Hex; yParity: 0 | 1 }) {
  const s = BigInt(sig.s)
  if (s <= SECP256K1_N / 2n) return sig
  return {
    r: sig.r,
    s: `0x${(SECP256K1_N - s).toString(16).padStart(64, '0')}` as Hex,
    yParity: (1 - sig.yParity) as 0 | 1,
  }
}

// The warehouse only calls the router, and only approves USDG for the router. Nothing else gets a signature.
function check(tx: TransactionSerializableEIP1559, limits: Limits, routers: readonly Address[]) {
  const fail = (code: string, why: string) => {
    throw new ChainsigError(code, why)
  }
  if (tx.type !== 'eip1559') fail('not_eip1559', `type ${String(tx.type)}`)
  if (tx.chainId !== ROBINHOOD_CHAIN_ID) fail('wrong_chain', `chain ${tx.chainId}`)
  if (tx.value !== undefined && tx.value !== 0n) fail('value_not_zero', `value ${tx.value}`)
  if (tx.gas === undefined || tx.gas > limits.maxGas) fail('gas_too_high', `gas ${tx.gas}`)
  const fee = tx.maxFeePerGas
  if (fee === undefined || fee > limits.maxFeePerGas || (tx.maxPriorityFeePerGas ?? 0n) > fee)
    fail('fee_too_high', `maxFeePerGas ${fee}, tip ${tx.maxPriorityFeePerGas}`)

  const to = tx.to
  if (!to) return fail('wrong_target', 'no recipient')
  const isRouter = (a: Address) => routers.some((r) => isAddressEqual(r, a))
  if (isRouter(to)) return
  if (isAddressEqual(to, USDG)) {
    let call: ReturnType<typeof decodeFunctionData<typeof erc20Abi>> | undefined
    try {
      call = decodeFunctionData({ abi: erc20Abi, data: tx.data ?? '0x' })
    } catch {
      // not an ERC-20 call
    }
    if (call?.functionName === 'approve' && isRouter(call.args[0])) {
      const max = limits.maxApprove ?? DEFAULT_LIMITS.maxApprove!
      if (call.args[1] > max) fail('approve_too_high', `approve ${call.args[1]} > ${max}`)
      return
    }
    fail('wrong_target', `USDG call other than approve(router): ${call?.functionName ?? 'unknown'}`)
  }
  fail('wrong_target', `to ${to}`)
}

export function warehouse(deps: {
  mpc: Mpc
  chain: EvmChain
  limits?: Limits
  routers?: readonly Address[]
  path?: string
}) {
  const { mpc, chain } = deps
  const limits = deps.limits ?? DEFAULT_LIMITS
  const routers = deps.routers ?? [KYBER_ROUTER]
  const path = deps.path ?? WAREHOUSE_PATH
  let cached: Address | undefined

  async function address(): Promise<Address> {
    if (cached) return cached
    const raw = PublicKey.fromString(await mpc.derivedPublicKey(path)).data // 64 bytes, x‖y
    if (raw.length !== 64) throw new ChainsigError('bad_mpc_answer', `derived key is ${raw.length} bytes`)
    cached = publicKeyToAddress(`0x04${Buffer.from(raw).toString('hex')}`)
    return cached
  }

  // Checks, signs through the MPC and verifies the signer. Returns the signed raw transaction, not yet sent.
  async function sign(input: TransactionSerializableEIP1559): Promise<Hex> {
    check(input, limits, routers)
    const from = await address()
    const tx = { ...input, nonce: input.nonce ?? (await chain.getTransactionCount(from)) }
    const sig = lowS(parseMpcSignature(await mpc.sign(keccak256(serializeTransaction(tx)), path)))
    const raw = serializeTransaction(tx, sig)
    const signer = await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })
    if (!isAddressEqual(signer, from)) throw new ChainsigError('wrong_signer', `signed by ${signer}, not ${from}`)
    return raw
  }

  // Signs, broadcasts and waits for the receipt. A reverted transaction throws with its hash (its nonce is spent).
  async function signAndSend(tx: TransactionSerializableEIP1559): Promise<{ hash: Hex; blockNumber: bigint }> {
    const hash = await chain.sendRawTransaction(await sign(tx))
    const receipt = await chain.waitForReceipt(hash)
    if (receipt.status !== 'success') throw new ChainsigError('reverted', `transaction ${hash} reverted`, hash)
    return { hash, blockNumber: receipt.blockNumber }
  }

  return { address, sign, signAndSend }
}

// The real MPC contract, called by `accountId`. `sign` needs 1 yocto, so `key` must be a full-access key.
// The warehouse address depends on accountId, path and network: changing any of them gives a different address.
export function nearMpc(opts: {
  network: Config['NEAR_NETWORK']
  accountId: string
  key: string
  contractId?: string
}): Mpc {
  const provider = nearProvider(opts.network)
  const contractId = opts.contractId ?? MPC_BY_NETWORK[opts.network]
  const account = new Account(opts.accountId, provider, opts.key as KeyPairString)
  return {
    derivedPublicKey: (path) =>
      provider.callFunction({
        contractId,
        method: 'derived_public_key',
        args: { path, predecessor: opts.accountId, domain_id: DOMAIN_SECP256K1 },
      }) as Promise<string>,
    sign: (hash, path) =>
      account.callFunction({
        contractId,
        methodName: 'sign',
        args: { request: { path, payload_v2: { Ecdsa: hash.slice(2) }, domain_id: DOMAIN_SECP256K1 } },
        deposit: 1n,
        gas: teraToGas('250'),
      }),
  }
}

export function robinhoodChain(): EvmChain {
  const client = createPublicClient({
    transport: fallback(ROBINHOOD_RPCS.map((url) => http(url, { timeout: 15_000 }))),
  })
  return {
    getTransactionCount: (address) => client.getTransactionCount({ address, blockTag: 'pending' }),
    sendRawTransaction: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
    waitForReceipt: (hash) => client.waitForTransactionReceipt({ hash, timeout: 120_000 }),
  }
}

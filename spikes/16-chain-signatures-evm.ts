// 16 · Chain Signatures → Robinhood Chain (EVM, MPC domain 0 / Secp256k1). Testnet MPC, real sign request, no broadcast.
// 1. derive the EVM address for our NEAR account + path
// 2. build a real USDG → TSLA swap transaction for that address (KyberSwap route build, chain 4663)
// 3. sign its EIP-1559 hash through the MPC contract (1 yocto), assemble the signed tx
// 4. recover the signer from the signed tx: it must be the derived address
import { Account, type KeyPairString, PublicKey, teraToGas } from 'near-api-js'
import {
  createPublicClient,
  fallback,
  http,
  keccak256,
  recoverTransactionAddress,
  serializeTransaction,
  type Hex,
  type TransactionSerializableEIP1559,
} from 'viem'
import { publicKeyToAddress } from 'viem/accounts'
import { needEnv, provider, save, timed, view } from './lib.ts'

const MPC = 'v1.signer-prod.testnet'
const PATH = 'nyxeron-warehouse-hood'
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
const TSLA = '0x322F0929c4625eD5bAd873c95208D54E1c003b2d' // genuine, verified in spike 15
const playerId = needEnv('SPIKE_PLAYER')
const player = new Account(playerId, provider('testnet'), needEnv('SPIKE_PLAYER_KEY') as KeyPairString)
const hood = createPublicClient({
  transport: fallback([http('https://robinhood-rpc.publicnode.com'), http('https://robinhood.drpc.org')]),
})

// 1. Derived Secp256k1 key → EVM address.
const derived = await view<string>('testnet', MPC, 'derived_public_key', {
  path: PATH,
  predecessor: playerId,
  domain_id: 0,
})
const raw = PublicKey.fromString(derived).data // 64 bytes, x‖y
const address = publicKeyToAddress(`0x04${Buffer.from(raw).toString('hex')}`)

// 2. A real swap for that address.
const base = 'https://aggregator-api.kyberswap.com/robinhood/api/v1'
const route = (await (await fetch(`${base}/routes?tokenIn=${USDG}&tokenOut=${TSLA}&amountIn=1000000`)).json()) as {
  data: { routeSummary: unknown; routerAddress: string }
}
const build = (await (
  await fetch(`${base}/route/build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      routeSummary: route.data.routeSummary,
      sender: address,
      recipient: address,
      slippageTolerance: 100,
      skipSimulateTx: true,
    }),
  })
).json()) as { data?: { data: Hex; routerAddress: Hex; amountOut: string }; message?: string }
if (!build.data) throw new Error(`route build failed: ${build.message}`)

const gasPrice = await hood.getGasPrice()
const tx: TransactionSerializableEIP1559 = {
  type: 'eip1559',
  chainId: 4663,
  nonce: await hood.getTransactionCount({ address }),
  to: build.data.routerAddress,
  data: build.data.data,
  value: 0n,
  gas: 800_000n, // the address holds nothing, so estimateGas would fail; enough for the swap
  maxFeePerGas: gasPrice * 2n,
  maxPriorityFeePerGas: 0n,
}
const hash = keccak256(serializeTransaction(tx))

// 3. MPC signs the 32-byte hash.
const signed = await timed(() =>
  player.callFunction({
    contractId: MPC,
    methodName: 'sign',
    args: { request: { path: PATH, payload_v2: { Ecdsa: hash.slice(2) }, domain_id: 0 } },
    deposit: 1n,
    gas: teraToGas('250'),
  }),
)
type EcdsaResult = { big_r: { affine_point: string }; s: { scalar: string }; recovery_id: number }
const res = signed.value as EcdsaResult | { Secp256k1: EcdsaResult }
const sig = 'Secp256k1' in res ? res.Secp256k1 : res
const r = `0x${sig.big_r.affine_point.slice(2)}` as Hex // drop the 02/03 parity prefix: r is the x coordinate
const s = `0x${sig.s.scalar}` as Hex
const signedTx = serializeTransaction(tx, { r, s, yParity: sig.recovery_id })

// 4. Who signed it?
const recovered = await recoverTransactionAddress({ serializedTransaction: signedTx as `0x02${string}` })

save('16-chain-signatures-evm', {
  mpcContract: MPC,
  path: PATH,
  predecessor: playerId,
  derivedKey: derived,
  evmAddress: address,
  swap: {
    router: build.data.routerAddress,
    calldataBytes: (build.data.data.length - 2) / 2,
    tslaOut: Number(build.data.amountOut) / 1e18,
  },
  txHash: hash,
  signRequest: { ms: signed.ms, resultKeys: Object.keys(res), recoveryId: sig.recovery_id },
  signedTxBytes: (signedTx.length - 2) / 2,
  recovered,
  signerMatches: recovered.toLowerCase() === address.toLowerCase(),
  note: 'not broadcast: the address holds no USDG or ETH',
})

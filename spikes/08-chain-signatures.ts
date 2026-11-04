// 08 · Chain Signatures → Solana (testnet MPC, real sign request; nothing is broadcast on Solana).
// 1. The MPC contract's Ed25519 key and the key derived for our account + path → that key *is* a Solana address.
// 2. Ask Jupiter for a real $1 USDC → TSLAx swap with that address as taker; take the transaction's message bytes.
// 3. Our NEAR account calls `sign` on the MPC contract (1 yocto); time it.
// 4. Verify the returned signature over the message with the derived public key.
import { createPublicKey, verify } from 'node:crypto'
import { Account, type KeyPairString, PublicKey, teraToGas } from 'near-api-js'
import { needEnv, provider, save, timed, view } from './lib.ts'

const MPC = 'v1.signer-prod.testnet'
const PATH = 'nyxeron-warehouse-sol'
const playerId = needEnv('SPIKE_PLAYER')
const player = new Account(playerId, provider('testnet'), needEnv('SPIKE_PLAYER_KEY') as KeyPairString)

const rootKey = await view<string>('testnet', MPC, 'public_key', { domain_id: 1 })
const derived = await view<string>('testnet', MPC, 'derived_public_key', {
  path: PATH,
  predecessor: playerId,
  domain_id: 1,
})
const solanaAddress = derived.replace('ed25519:', '') // same base58 encoding of the same 32 bytes

// A real swap transaction for that address (Solana mainnet route; we only sign its message).
// Swap v2 refuses an unfunded taker ("Insufficient funds"), so the message comes from Swap v1, which builds anyway.
const pair =
  'inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB'
const v2 = (await (
  await fetch(`https://api.jup.ag/swap/v2/order?${pair}&amount=1000000&taker=${solanaAddress}`)
).json()) as { transaction?: string; error?: string; feeBps?: number }
const v1Quote = await (
  await fetch(`https://lite-api.jup.ag/swap/v1/quote?${pair}&amount=1000000&slippageBps=100`)
).json()
const v1 = (await (
  await fetch('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse: v1Quote, userPublicKey: solanaAddress }),
  })
).json()) as { swapTransaction?: string }
if (!v1.swapTransaction) throw new Error(`no Jupiter transaction: ${JSON.stringify(v1).slice(0, 300)}`)
const order = { router: 'swap/v1', v2Refusal: v2.error, v2FeeBps: v2.feeBps }
const tx = Buffer.from(v1.swapTransaction, 'base64')
const numSigs = tx[0]! // compact-u16; < 128 signers fits in one byte
const message = tx.subarray(1 + numSigs * 64)

const signed = await timed(() =>
  player.callFunction({
    contractId: MPC,
    methodName: 'sign',
    args: { request: { path: PATH, payload_v2: { Eddsa: message.toString('hex') }, domain_id: 1 } },
    deposit: 1n,
    gas: teraToGas('250'),
  }),
)
const result = signed.value as { Ed25519?: { signature: number[] } } | { signature?: number[] }
const sigBytes = Buffer.from(
  ('Ed25519' in result ? result.Ed25519?.signature : (result as { signature?: number[] }).signature) ?? [],
)

const raw = Buffer.from(PublicKey.fromString(derived).data)
const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
const valid = sigBytes.length === 64 && verify(null, message, key, sigBytes)

save('08-chain-signatures', {
  mpcContract: MPC,
  mpcRootEd25519: rootKey,
  path: PATH,
  predecessor: playerId,
  derivedKey: derived,
  solanaAddress,
  jupiter: { ...order, txBytes: tx.length, signersNeeded: numSigs, messageBytes: message.length },
  signRequest: { ms: signed.ms, signatureBytes: sigBytes.length, resultShape: Object.keys(result) },
  signatureVerifies: valid,
})

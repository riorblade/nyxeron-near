// 03 · Meta transactions (NEP-366) on testnet: the player signs, the relayer submits and pays.
// a) full-access key, no deposit      → who pays the gas?
// b) full-access key, 1 yocto deposit → who pays the deposit? (ft_transfer_call needs exactly this)
// c) function-call key, no deposit    → allowed?
// d) function-call key, 1 yocto       → refused, and how?
import { Account, actions, KeyPair, type KeyPairString, teraToGas } from 'near-api-js'
import { needEnv, provider, save, timed } from './lib.ts'

const p = provider('testnet')
const CONTRACT = 'guestbook.near-examples.testnet'
const playerId = needEnv('SPIKE_PLAYER')
const relayerId = needEnv('SPIKE_RELAYER')
const player = new Account(playerId, p, needEnv('SPIKE_PLAYER_KEY') as KeyPairString)
const relayer = new Account(relayerId, p, needEnv('SPIKE_RELAYER_KEY') as KeyPairString)

const total = async (id: string) => BigInt((await new Account(id, p).getState()).balance.total)

async function relay(signer: Account, text: string, deposit: bigint) {
  const before = { player: await total(playerId), relayer: await total(relayerId) }
  try {
    const meta = await signer.createSignedMetaTransaction({
      receiverId: CONTRACT,
      actions: [actions.functionCall('add_message', { text }, teraToGas('30'), deposit)],
    })
    const sent = await timed(() => relayer.relayMetaTransaction(meta.signedDelegate))
    const outcome = sent.value as {
      transaction: { hash: string }
      status: unknown
      receipts_outcome: { outcome: { status: unknown } }[]
    }
    // Unused gas comes back in later refund receipts: wait for them before reading balances.
    await new Promise((r) => setTimeout(r, 8000))
    const failures = outcome.receipts_outcome
      .map((r) => r.outcome.status)
      .filter((s) => JSON.stringify(s).includes('Failure'))
    const after = { player: await total(playerId), relayer: await total(relayerId) }
    return {
      ok: failures.length === 0,
      hash: outcome.transaction.hash,
      ms: sent.ms,
      playerDeltaYocto: (after.player - before.player).toString(),
      relayerDeltaYocto: (after.relayer - before.relayer).toString(),
      failures,
    }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 400) }
  }
}

const results: Record<string, unknown> = {}
results.a_fullKey_noDeposit = await relay(player, 'spike 03a', 0n)
results.b_fullKey_oneYocto = await relay(player, 'spike 03b', 1n)

// Add a function-call key for the guestbook only (signed by the player's full key, paid by the player here).
const fc = KeyPair.fromRandom('ed25519')
await player.addFunctionCallAccessKey({
  publicKey: fc.getPublicKey(),
  contractId: CONTRACT,
  methodNames: ['add_message'],
  allowance: 0n,
} as never)
const session = new Account(playerId, p, fc.toString() as KeyPairString)
results.c_functionCallKey_noDeposit = await relay(session, 'spike 03c', 0n)
results.d_functionCallKey_oneYocto = await relay(session, 'spike 03d', 1n)

save('03-meta-tx', { contract: CONTRACT, player: playerId, relayer: relayerId, ...results })

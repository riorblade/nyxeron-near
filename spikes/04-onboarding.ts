// 04 · Onboarding a player who has no NEAR at all (testnet):
// 1. fresh ed25519 key → implicit account id (what a Privy NEAR wallet is) — does it exist yet?
// 2. relayer sends 0 NEAR → account exists? cost? storage?
// 3. relayer pays USDC storage_deposit for the player
// 4. player (0 NEAR) signs a call through the relayer
// 5. player adds a function-call key through the relayer: does the free storage (770 bytes) cover it?
import {
  Account,
  actions,
  KeyPair,
  type KeyPairString,
  keyToImplicitAddress,
  nearToYocto,
  teraToGas,
} from 'near-api-js'
import { needEnv, provider, rpc, save, timed, view } from './lib.ts'

const USDC_TESTNET = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'
const p = provider('testnet')
const relayerId = needEnv('SPIKE_RELAYER')
const relayer = new Account(relayerId, p, needEnv('SPIKE_RELAYER_KEY') as KeyPairString)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const relayerTotal = async () => BigInt((await new Account(relayerId, p).getState()).balance.total)

type AccountView = { amount: string; storage_usage: number }
const viewAccount = (id: string) =>
  rpc<AccountView>('testnet', 'query', { request_type: 'view_account', finality: 'final', account_id: id }).catch(
    (e: unknown) => String(e).slice(0, 160),
  )

const key = KeyPair.fromRandom('ed25519')
const playerId = keyToImplicitAddress(key.getPublicKey())
const out: Record<string, unknown> = { playerId }

out.beforeFunding = await viewAccount(playerId)

// 2. 0 NEAR transfer creates the account.
let before = await relayerTotal()
const create = await timed(() => relayer.transfer({ receiverId: playerId, amount: 0n }))
await sleep(8000)
out.create = {
  ms: create.ms,
  hash: (create.value as { transaction: { hash: string } }).transaction.hash,
  relayerPaidYocto: (before - (await relayerTotal())).toString(),
  account: await viewAccount(playerId),
}

// 3. Relayer registers the player on USDC.
before = await relayerTotal()
const reg = await timed(() =>
  relayer.callFunction({
    contractId: USDC_TESTNET,
    methodName: 'storage_deposit',
    args: { account_id: playerId, registration_only: true },
    deposit: nearToYocto('0.00125'),
    gas: teraToGas('30'),
  }),
)
await sleep(8000)
out.usdcRegistration = {
  ms: reg.ms,
  relayerPaidYocto: (before - (await relayerTotal())).toString(),
  storageBalance: await view('testnet', USDC_TESTNET, 'storage_balance_of', { account_id: playerId }),
}

// 4. The player, still holding 0 NEAR, acts through the relayer.
const player = new Account(playerId, p, key.toString() as KeyPairString)
const meta = await player.createSignedMetaTransaction({
  receiverId: 'guestbook.near-examples.testnet',
  actions: [actions.functionCall('add_message', { text: 'spike 04: zero-NEAR player' }, teraToGas('30'), 0n)],
})
const act = await timed(() => relayer.relayMetaTransaction(meta.signedDelegate))
out.zeroNearPlayerCall = {
  ms: act.ms,
  hash: (act.value as { transaction: { hash: string } }).transaction.hash,
  account: await viewAccount(playerId),
}

// 5. Add a function-call key on the player's own account, through the relayer.
const session = KeyPair.fromRandom('ed25519')
try {
  const addKey = await player.createSignedMetaTransaction({
    receiverId: playerId,
    actions: [
      actions.addFunctionCallAccessKey(session.getPublicKey(), 'guestbook.near-examples.testnet', ['add_message']),
    ],
  })
  const added = await timed(() => relayer.relayMetaTransaction(addKey.signedDelegate))
  await sleep(4000)
  out.addSessionKey = {
    ok: true,
    ms: added.ms,
    hash: (added.value as { transaction: { hash: string } }).transaction.hash,
    account: await viewAccount(playerId),
  }
} catch (err) {
  out.addSessionKey = { ok: false, error: String(err).slice(0, 400), account: await viewAccount(playerId) }
}

save('04-onboarding', out)

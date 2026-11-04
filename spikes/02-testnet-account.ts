// 02 · Testnet accounts from the faucet service (the one near-cli uses), then a first transaction, timed.
// Creates a "player" and a "relayer" account and writes their keys to spikes/.env (git-ignored).
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Account, KeyPair, type KeyPairString, nearToYocto } from 'near-api-js'
import { provider, save, timed } from './lib.ts'

const FAUCET = 'https://helper.nearprotocol.com/account'
const envFile = join(import.meta.dirname, '.env')

async function create(role: string) {
  const id = `nyx-${role}-${Date.now().toString(36)}.testnet`
  const key = KeyPair.fromRandom('ed25519')
  const res = await fetch(FAUCET, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.getPublicKey().toString() }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`faucet ${res.status}: ${text.slice(0, 300)}`)
  return { id, key: key.toString() as KeyPairString }
}

if (existsSync(envFile) && process.env.SPIKE_PLAYER) {
  console.log('accounts already in spikes/.env; delete it to make new ones')
  process.exit(0)
}

const made = await timed(async () => [await create('player'), await create('relayer')])
const [player, relayer] = made.value as [{ id: string; key: KeyPairString }, { id: string; key: KeyPairString }]
appendFileSync(
  envFile,
  `SPIKE_PLAYER=${player.id}\nSPIKE_PLAYER_KEY=${player.key}\nSPIKE_RELAYER=${relayer.id}\nSPIKE_RELAYER_KEY=${relayer.key}\n`,
)

const p = provider('testnet')
const balance = await new Account(player.id, p).getState()

// First transaction: player sends 0.01 NEAR to the relayer, waiting until final.
const acc = new Account(player.id, p, player.key)
const tx = await timed(() =>
  acc.transfer({ receiverId: relayer.id, amount: nearToYocto('0.01'), waitUntil: 'FINAL' } as never),
)
const outcome = tx.value as { transaction: { hash: string } }

save('02-testnet-account', {
  faucet: FAUCET,
  createdBothMs: made.ms,
  player: player.id,
  relayer: relayer.id,
  startingBalanceYocto: balance.balance.total.toString(),
  firstTransfer: { hash: outcome.transaction.hash, untilFinalMs: tx.ms },
  explorer: `https://testnet.nearblocks.io/txns/${outcome.transaction.hash}`,
})

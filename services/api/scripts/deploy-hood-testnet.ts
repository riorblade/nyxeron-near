// Deploys contracts/hood-testnet to Robinhood Chain testnet and writes the addresses to src/hood-testnet.ts.
//
//   cd contracts/hood-testnet && forge build
//   DEPLOYER_KEY_FILE=~/.config/nyxeron/hood-testnet-deployer.key WAREHOUSE=0x… \
//     node services/api/scripts/deploy-hood-testnet.ts
//
// WAREHOUSE is the api's warehouse address for the testnet WAREHOUSE_ACCOUNT_ID (its start-up log prints it, or
// chainsig.ts's warehouse().address()). It becomes the market's price poster and gets the test dollars and some of the
// deployer's testnet ETH for gas. The deployer key is a testnet-only key, read from a file and never printed.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, formatEther, getAddress, type Hex, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { deployHoodTestnet } from '../src/hood-deploy.ts'
import { HOOD_TESTNET_CHAIN_ID } from '../src/hoodnet.ts'

const RPC = process.env.HOOD_TESTNET_RPC ?? 'https://rpc.testnet.chain.robinhood.com'
const keyFile = process.env.DEPLOYER_KEY_FILE?.replace(/^~/, process.env.HOME ?? '~')
if (!keyFile || !process.env.WAREHOUSE) throw new Error('set DEPLOYER_KEY_FILE and WAREHOUSE')
const warehouse = getAddress(process.env.WAREHOUSE)
const raw = readFileSync(keyFile, 'utf8').trim()
const deployer = privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as Hex)
const chain = {
  id: HOOD_TESTNET_CHAIN_ID,
  name: 'Robinhood Chain testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const
const client = createPublicClient({ chain, transport: http(RPC) })
const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) })

const balance = await client.getBalance({ address: deployer.address })
console.log(`deployer ${deployer.address}: ${formatEther(balance)} ETH`)
if (balance === 0n) throw new Error('the deployer has no testnet ETH: use the faucet first')

const deployed = await deployHoodTestnet({
  wallet,
  client,
  warehouse,
  usdgForWarehouse: 100_000_000_000n, // $100,000 of test dollars
  log: console.log,
})
// Gas for the warehouse's approves, price posts and swaps (≈ 0.01 gwei): half of what the deployer has left.
const left = await client.getBalance({ address: deployer.address })
const gas = left / 2n < parseEther('0.05') ? left / 2n : parseEther('0.05')
await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: warehouse, value: gas }) })
console.log(`${formatEther(gas)} ETH → warehouse ${warehouse}`)

const out = join(import.meta.dirname, '../src/hood-testnet.ts')
writeFileSync(
  out,
  `// Written by scripts/deploy-hood-testnet.ts on ${new Date().toISOString().slice(0, 10)} (Robinhood Chain testnet, chain ${HOOD_TESTNET_CHAIN_ID}).
// Warehouse (price poster, holds the test dollars): ${warehouse}.
import type { HoodTestnetDeploy } from './hoodnet.ts'

export const HOOD_TESTNET_DEPLOY: HoodTestnetDeploy | null = ${JSON.stringify(deployed, null, 2)}
`,
)
console.log(`wrote ${out}`)

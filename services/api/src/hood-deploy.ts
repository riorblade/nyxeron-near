// Deploys contracts/hood-testnet (test dollars, ten synthetic stocks, the market) and hands the warehouse what it needs:
// the right to post prices, and test dollars to buy with. Used by scripts/deploy-hood-testnet.ts and the anvil test.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenIds, tokens } from '@nyxeron/game'
import type { Abi, Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from 'viem'
import type { HoodTestnetDeploy } from './hoodnet.ts'

export const HOOD_CONTRACTS_DIR = join(import.meta.dirname, '../../../contracts/hood-testnet')

type Artifact = { abi: Abi; bytecode: Hex }
export function artifact(name: 'TestUSDG' | 'SyntheticStock' | 'SyntheticMarket', dir = HOOD_CONTRACTS_DIR): Artifact {
  const json = JSON.parse(readFileSync(join(dir, 'out/Synthetic.sol', `${name}.json`), 'utf8')) as {
    abi: Abi
    bytecode: { object: Hex }
  }
  return { abi: json.abi, bytecode: json.bytecode.object }
}

export async function deployHoodTestnet(opts: {
  wallet: WalletClient<Transport, Chain, Account>
  client: PublicClient
  warehouse: Address
  usdgForWarehouse: bigint // micro-USDG
  log?: (msg: string) => void
}): Promise<HoodTestnetDeploy> {
  const { wallet, client } = opts
  const log = opts.log ?? (() => {})
  const mined = async (hash: Hex) => {
    const r = await client.waitForTransactionReceipt({ hash })
    if (r.status !== 'success') throw new Error(`reverted: ${hash}`)
    return r
  }
  const deploy = async (name: Parameters<typeof artifact>[0], args: unknown[]) => {
    const a = artifact(name)
    const r = await mined(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args }))
    log(`${name} ${args.length ? JSON.stringify(args) : ''} → ${r.contractAddress}`)
    return r.contractAddress!
  }
  const call = async (address: Address, name: Parameters<typeof artifact>[0], fn: string, args: unknown[]) =>
    mined(await wallet.writeContract({ address, abi: artifact(name).abi, functionName: fn, args }))

  const usdg = await deploy('TestUSDG', [])
  const market = await deploy('SyntheticMarket', [usdg])
  const deployed = {} as Record<(typeof tokenIds)[number], string>
  for (const id of tokenIds) {
    const t = tokens[id]
    const stock = await deploy('SyntheticStock', [`Synthetic ${t.name} (testnet)`, `s${t.ticker}`, market])
    await call(market, 'SyntheticMarket', 'list', [stock])
    deployed[id] = stock
  }
  // The warehouse posts the live price before it buys (market.ts), and pays in test dollars.
  await call(market, 'SyntheticMarket', 'setPoster', [opts.warehouse])
  await call(usdg, 'TestUSDG', 'mint', [opts.warehouse, opts.usdgForWarehouse])
  log(`poster and ${opts.usdgForWarehouse} µtUSDG → warehouse ${opts.warehouse}`)
  return { usdg, market, tokens: deployed }
}

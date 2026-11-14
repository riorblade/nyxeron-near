// End to end on a local chain: contracts/hood-testnet deployed to anvil, then the real warehouse buyer (swap.ts) buying
// through the real market adapter (market.ts) and the real signing checks (chainsig.ts), with only the MPC faked by a
// local key. Needs Foundry (`anvil`) and `forge build` in contracts/hood-testnet; skipped without them (CI's ts job).
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { baseEncode } from 'near-api-js'
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  type Hex,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
} from 'viem'
import { privateKeyToAccount, sign } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Mpc, warehouse } from './chainsig.ts'
import { all, openDb } from './db.ts'
import { deployHoodTestnet, HOOD_CONTRACTS_DIR } from './hood-deploy.ts'
import { type HoodNet, hoodTestnet } from './hoodnet.ts'
import { marketReader, syntheticMarket } from './market.ts'
import { robinhoodHood, warehouseBuyer } from './swap.ts'
import { robinhoodChain } from './chainsig.ts'

const hasFoundry = (() => {
  try {
    execFileSync('anvil', ['--version'], { stdio: 'ignore' })
    return existsSync(join(HOOD_CONTRACTS_DIR, 'out/Synthetic.sol/SyntheticMarket.json'))
  } catch {
    return false
  }
})()

const PORT = 18545 + Math.floor(Math.random() * 1000)
const RPC = `http://127.0.0.1:${PORT}`
// anvil's first dev account (public, well known) deploys; the warehouse is a fresh key behind a fake MPC.
const DEPLOYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const WAREHOUSE_KEY = `0x${'42'.repeat(32)}` as Hex
const WAREHOUSE = privateKeyToAccount(WAREHOUSE_KEY)
const chain = {
  id: 46630,
  name: 'anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const

const mpc: Mpc = {
  async derivedPublicKey() {
    return `secp256k1:${baseEncode(Buffer.from(WAREHOUSE.publicKey.slice(4), 'hex'))}`
  },
  async sign(hash) {
    const sig = await sign({ hash, privateKey: WAREHOUSE_KEY })
    return {
      scheme: 'Secp256k1',
      big_r: { affine_point: `${sig.yParity === 0 ? '02' : '03'}${sig.r.slice(2)}` },
      s: { scalar: sig.s.slice(2).padStart(64, '0') },
      recovery_id: sig.yParity,
    }
  },
}

describe.skipIf(!hasFoundry)('a testnet purchase, end to end on anvil', () => {
  let anvil: ChildProcess
  let net: HoodNet

  beforeAll(async () => {
    // Robinhood Chain testnet's id, and its gas price (≈ 0.01 gwei) so the warehouse's fee cap applies as there.
    anvil = spawn('anvil', ['--port', String(PORT), '--chain-id', '46630', '--base-fee', '10000000', '--silent'])
    const client = createPublicClient({ chain, transport: http(RPC), pollingInterval: 100 })
    for (let i = 0; i < 50; i++) {
      if (await client.getChainId().catch(() => 0)) break
      await new Promise((r) => setTimeout(r, 100))
    }
    const wallet = createWalletClient({ account: DEPLOYER, chain, transport: http(RPC), pollingInterval: 100 })
    const deploy = await deployHoodTestnet({
      wallet,
      client,
      warehouse: WAREHOUSE.address,
      usdgForWarehouse: 1_000_000_000n,
    })
    await client.waitForTransactionReceipt({
      hash: await wallet.sendTransaction({ to: WAREHOUSE.address, value: parseEther('0.01') }),
    })
    net = { ...hoodTestnet(deploy)!, rpcs: [RPC] }
  }, 60_000)

  afterAll(() => {
    anvil?.kill()
  })

  it('buys the synthetic stock for test dollars and hands back a swap hash that proves it', async () => {
    const db = openDb(':memory:')
    const hood = robinhoodHood(net)
    const signer = warehouse({ mpc, chain: robinhoodChain(net), net })
    const price = async (id: string) => ({ tsla: 400, nvda: 180 })[id] ?? 0
    const kyber = syntheticMarket({ net, read: marketReader(net), signer, price, gasPrice: hood.gasPrice })
    const buyer = warehouseBuyer({ db, hood, kyber, signer, price, net, log: () => {} })

    const proof = await buyer.buyShares('p1', 'tsla', 10n) // 0.01 sTSLA ≈ $4
    expect(proof).toMatch(/^0x[0-9a-f]{64}$/)

    const client = createPublicClient({ chain, transport: http(RPC) })
    const receipt = await client.getTransactionReceipt({ hash: proof as Hex })
    const minted = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).filter(
      (l) => l.address.toLowerCase() === net.tokens.tsla.toLowerCase(),
    )
    expect(minted).toHaveLength(1)
    expect(minted[0]!.args.to).toBe(WAREHOUSE.address)
    expect(minted[0]!.args.value).toBeGreaterThanOrEqual(10n ** 16n)

    const ui = parseAbi(['function balanceOfUI(address) view returns (uint256)'])
    const held = await client.readContract({
      address: net.tokens.tsla,
      abi: ui,
      functionName: 'balanceOfUI',
      args: [WAREHOUSE.address],
    })
    expect(held).toBeGreaterThanOrEqual(10n ** 16n)
    const left = await client.readContract({
      address: net.usdg,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [WAREHOUSE.address],
    })
    expect(left).toBeLessThan(1_000_000_000n - 4_000_000n)
    expect(all<{ status: string }>(db, 'SELECT status FROM warehouse_swaps')).toEqual([{ status: 'done' }])

    // A second party, same stock: the posted price is still fresh, so no new setPrice, just approve + swap.
    const nonceBefore = await client.getTransactionCount({ address: WAREHOUSE.address })
    await buyer.buyShares('p2', 'tsla', 5n)
    expect(await client.getTransactionCount({ address: WAREHOUSE.address })).toBe(nonceBefore + 2)
  }, 60_000)
})

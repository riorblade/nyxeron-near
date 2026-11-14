import { tokenIds } from '@nyxeron/game'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Abi,
  type AbiFunction,
  type Address,
  decodeFunctionData,
  type Hex,
  toFunctionSelector,
  type TransactionSerializableEIP1559,
} from 'viem'
import { describe, expect, it } from 'vitest'
import type { HoodNet } from './hoodnet.ts'
import { HOOD_CONTRACTS_DIR } from './hood-deploy.ts'
import { MARKET_ABI, REPOST_AFTER_S, syntheticMarket } from './market.ts'
import { checkSwapCall } from './swap.ts'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const NET: HoodNet = {
  name: 'testnet',
  chainId: 46630,
  rpcs: [],
  explorer: '',
  usdg: addr(1),
  router: addr(2),
  tokens: Object.fromEntries(tokenIds.map((id, i) => [id, addr(100 + i)])) as HoodNet['tokens'],
  synthetic: true,
}
const ARTIFACT = join(HOOD_CONTRACTS_DIR, 'out/Synthetic.sol/SyntheticMarket.json')
const TSLA = NET.tokens.tsla
const WAREHOUSE = addr(0xaaa)
const NOW_S = 1_800_000_000
const E18 = 10n ** 18n

function setup(onChain: { priceMicro: bigint; at: number }, spot = 400) {
  const sent: TransactionSerializableEIP1559[] = []
  const market = syntheticMarket({
    net: NET,
    read: { posted: async () => ({ ...onChain, at: BigInt(onChain.at) }) },
    signer: {
      async signAndSend(tx) {
        sent.push(tx)
        return { hash: '0x01' as Hex }
      },
    },
    price: async (id) => (id === 'tsla' ? spot : 0),
    gasPrice: async () => 10_000_000n,
    nowS: () => NOW_S,
  })
  return { market, sent }
}

describe('the synthetic market (testnet Kyber)', () => {
  it('posts the live price when the market has none, then quotes at it', async () => {
    const t = setup({ priceMicro: 0n, at: 0 })
    const route = await t.market.route(NET.usdg, TSLA, 4_000_000n)
    expect(route.amountOut).toBe((E18 / 100n).toString()) // $4 at $400
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]!.to).toBe(NET.router)
    expect(t.sent[0]!.chainId).toBe(46630)
    const call = decodeFunctionData({ abi: MARKET_ABI, data: t.sent[0]!.data! })
    expect(call.functionName).toBe('setPrice')
    expect(call.args).toEqual([TSLA, 400_000_000n])
  })

  it("keeps a fresh price that's within 0.25 % of the market", async () => {
    const t = setup({ priceMicro: 400_900_000n, at: NOW_S - 60 })
    const route = await t.market.route(NET.usdg, TSLA, 4_009_000n)
    expect(t.sent).toHaveLength(0)
    expect(route.amountOut).toBe((E18 / 100n).toString())
  })

  it('reposts a price that moved more than 0.25 %, or got old', async () => {
    const moved = setup({ priceMicro: 402_000_000n, at: NOW_S - 60 })
    await moved.market.route(NET.usdg, TSLA, 4_000_000n)
    expect(moved.sent).toHaveLength(1)
    const old = setup({ priceMicro: 400_000_000n, at: NOW_S - REPOST_AFTER_S - 1 })
    await old.market.route(NET.usdg, TSLA, 4_000_000n)
    expect(old.sent).toHaveLength(1)
  })

  it("refuses what isn't test dollars into a listed stock, and a missing price", async () => {
    const t = setup({ priceMicro: 0n, at: 0 })
    await expect(t.market.route(addr(9), TSLA, 1n)).rejects.toThrow('market_src')
    await expect(t.market.route(NET.usdg, addr(9), 1n)).rejects.toThrow('market_token')
    await expect(t.market.route(NET.usdg, NET.tokens.nvda, 1n)).rejects.toThrow('no_price')
  })

  it("builds the swap call swap.ts's checks accept, minimum out after slippage", async () => {
    const t = setup({ priceMicro: 400_000_000n, at: NOW_S })
    const route = await t.market.route(NET.usdg, TSLA, 4_000_000n)
    const built = await t.market.build(route, WAREHOUSE, 50n)
    expect(built.routerAddress).toBe(NET.router)
    const minOut = checkSwapCall(built.data, {
      from: WAREHOUSE,
      token: TSLA,
      amountIn: 4_000_000n,
      needRaw: ((E18 / 100n) * 995n) / 1000n,
      usdg: NET.usdg,
    })
    expect(minOut).toBe(((E18 / 100n) * 9_950n) / 10_000n)
  })

  // The forge artifact, when contracts/hood-testnet is built (CI's hood-testnet job; the anvil test covers the rest).
  it.skipIf(!existsSync(ARTIFACT))("its ABI is the Solidity market's: same selectors", () => {
    const sol = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { abi: Abi }
    const selectors = (abi: Abi) =>
      abi.filter((f) => f.type === 'function').map((f) => toFunctionSelector(f as AbiFunction))
    for (const s of selectors(MARKET_ABI)) expect(selectors(sol.abi)).toContain(s)
  })
})

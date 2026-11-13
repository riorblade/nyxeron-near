// Testnet's stand-in for KyberSwap (hoodnet.ts): our SyntheticMarket on Robinhood Chain testnet. It sells synthetic
// stocks for test dollars at a posted price, through the same `swap` call Kyber's router takes, so swap.ts builds,
// checks and proves a testnet purchase exactly like a mainnet one. Before quoting, the warehouse posts the live market
// price (quotes.ts's spot) when the market's is missing, old, or off: the market is the router, so chainsig.ts already
// allows that call, and swap.ts's 2 % under-market rule still holds against the real price.
import { type TokenId, tokenIds } from '@nyxeron/game'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  fallback,
  http,
  isAddressEqual,
  parseAbi,
  type TransactionSerializableEIP1559,
  zeroAddress,
} from 'viem'
import { DEFAULT_LIMITS } from './chainsig.ts'
import type { HoodNet } from './hoodnet.ts'
import { SettlementError } from './settlement.ts'
import type { Built, Kyber, Route, Signer } from './swap.ts'

export const MARKET_ABI = parseAbi([
  'struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }',
  'struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }',
  'function swap(SwapExecutionParams execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
  'function setPrice(address token, uint256 priceMicro_)',
  'function priceMicro(address) view returns (uint256)',
  'function pricedAt(address) view returns (uint256)',
])

// The market refuses a price older than an hour; repost well before that, and whenever it is 0.25 % off the market.
export const REPOST_AFTER_S = 30 * 60
const REPOST_OFF_BPS = 25n
const BPS = 10_000n
const E18 = 10n ** 18n
const SET_PRICE_GAS = 100_000n
const SWAP_GAS = '250000'

export type MarketReader = { posted(token: Address): Promise<{ priceMicro: bigint; at: bigint }> }

type Summary = { token: Address; amountIn: string; amountOut: string }

export function syntheticMarket(deps: {
  net: HoodNet
  read: MarketReader
  signer: Pick<Signer, 'signAndSend'>
  // USD per whole token from the real market (quotes.ts's spot).
  price: (token: TokenId) => Promise<number>
  gasPrice: () => Promise<bigint>
  nowS?: () => number
}): Kyber {
  const { net, read, signer } = deps
  const nowS = deps.nowS ?? (() => Math.floor(Date.now() / 1000))
  const idOf = (token: Address) => tokenIds.find((id) => isAddressEqual(net.tokens[id], token))

  // The price the market will sell at once this returns, posting the live one first if needed.
  async function freshPrice(token: Address, id: TokenId): Promise<bigint> {
    const spot = await deps.price(id)
    if (!Number.isFinite(spot) || spot <= 0) throw new SettlementError('no_price')
    const want = BigInt(Math.round(spot * 1_000_000))
    const p = await read.posted(token)
    const off = p.priceMicro > want ? p.priceMicro - want : want - p.priceMicro
    const fresh =
      p.priceMicro > 0n && BigInt(nowS()) - p.at <= BigInt(REPOST_AFTER_S) && off * BPS <= want * REPOST_OFF_BPS
    if (fresh) return p.priceMicro
    const gas = await deps.gasPrice()
    const fee = gas * 2n < DEFAULT_LIMITS.maxFeePerGas ? gas * 2n : DEFAULT_LIMITS.maxFeePerGas
    await signer.signAndSend({
      type: 'eip1559',
      chainId: net.chainId,
      to: net.router,
      data: encodeFunctionData({ abi: MARKET_ABI, functionName: 'setPrice', args: [token, want] }),
      value: 0n,
      gas: SET_PRICE_GAS,
      maxFeePerGas: fee,
      maxPriorityFeePerGas: 0n,
    } satisfies TransactionSerializableEIP1559)
    return want
  }

  return {
    async route(tokenIn, tokenOut, amountIn) {
      if (!isAddressEqual(tokenIn, net.usdg)) throw new SettlementError('market_src', true)
      const id = idOf(tokenOut)
      if (!id) throw new SettlementError('market_token', true)
      const price = await freshPrice(tokenOut, id)
      const amountOut = ((amountIn * E18) / price).toString()
      const summary: Summary = { token: tokenOut, amountIn: amountIn.toString(), amountOut }
      return { amountIn: summary.amountIn, amountOut, summary }
    },
    async build(route: Route, from: Address, slippageBps: bigint): Promise<Built> {
      const s = route.summary as Summary
      const minOut = (BigInt(s.amountOut) * (BPS - slippageBps)) / BPS
      const data = encodeFunctionData({
        abi: MARKET_ABI,
        functionName: 'swap',
        args: [
          {
            callTarget: zeroAddress,
            approveTarget: zeroAddress,
            targetData: '0x',
            desc: {
              srcToken: net.usdg,
              dstToken: s.token,
              srcReceivers: [],
              srcAmounts: [],
              feeReceivers: [],
              feeAmounts: [],
              dstReceiver: from,
              amount: BigInt(s.amountIn),
              minReturnAmount: minOut,
              flags: 0n,
              permit: '0x',
            },
            clientData: '0x',
          },
        ],
      })
      return { amountIn: s.amountIn, amountOut: s.amountOut, gas: SWAP_GAS, data, routerAddress: net.router }
    },
  }
}

/** Reads the market's posted prices on Robinhood Chain testnet. */
export function marketReader(net: HoodNet): MarketReader {
  const client = createPublicClient({ transport: fallback(net.rpcs.map((url) => http(url, { timeout: 15_000 }))) })
  return {
    async posted(token) {
      const [priceMicro, at] = await Promise.all([
        client.readContract({ address: net.router, abi: MARKET_ABI, functionName: 'priceMicro', args: [token] }),
        client.readContract({ address: net.router, abi: MARKET_ABI, functionName: 'pricedAt', args: [token] }),
      ])
      return { priceMicro, at }
    },
  }
}

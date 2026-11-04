// 15 · Robinhood Chain as the stock backing (mainnet, read-only; dry quotes only).
// A. chain basics  B. which TSLA/NVDA/SPY contracts are genuine (on-chain check, not names)  C. what the token code
// can do to a holder  D. real swap routes USDG → TSLA  E. NEAR Intents dry quotes to Robinhood Chain.
// Robinhood's own RPC and docs resolve to an ISP block page in Indonesia (spike notes), so this uses public RPCs.
import { createPublicClient, fallback, http, keccak256, parseAbi, toFunctionSelector, type Address } from 'viem'
import { save } from './lib.ts'

const client = createPublicClient({
  transport: fallback([http('https://robinhood-rpc.publicnode.com'), http('https://robinhood.drpc.org')]),
})

// A. Chain basics.
const chainId = await client.getChainId()
const head = await client.getBlock()
const back = await client.getBlock({ blockNumber: head.number - 1000n })
const gasPrice = await client.getGasPrice()

// B. Candidates seen in the wild. Genuine = the shared beacon proxy (codehash + beacon slot), per the method in
// github.com/nirholas/robinhood-chain-alert-bot/issues/1.
const BEACON_PROXY_CODEHASH = '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630'
const BEACON = '0xe10b6f6b275de231345c20d14ab812db62151b00'
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50' // EIP-1967 beacon
const candidates: Record<string, Address> = {
  'TSLA (Quicknode, Trust Wallet, DexScreener)': '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
  'TSLA (hoodchain registry)': '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
  'NVDA "NVIDIA • Robinhood Token"': '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
  'NVDA "  NVIDIA Robinhood Token "': '0xA3284897ad7c8FED700b04f573Cf64E4f6c10f2c',
  'SPY "SPDR S&P 500 ETF Trust • Robinhood Token"': '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
}
const erc20 = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
])
const tokens: Record<string, unknown> = {}
for (const [label, address] of Object.entries(candidates)) {
  const code = await client.getCode({ address })
  const beaconWord = await client.getStorageAt({ address, slot: BEACON_SLOT })
  const beacon = beaconWord ? `0x${beaconWord.slice(26)}` : undefined
  const read = async (functionName: 'name' | 'symbol' | 'decimals' | 'totalSupply') =>
    client.readContract({ address, abi: erc20, functionName }).catch(() => undefined)
  const [name, symbol, decimals, supply] = await Promise.all([
    read('name'),
    read('symbol'),
    read('decimals'),
    read('totalSupply'),
  ])
  const codehash = code ? keccak256(code) : undefined
  tokens[label] = {
    address,
    name,
    symbol,
    decimals,
    totalSupply: supply !== undefined && typeof decimals === 'number' ? Number(supply) / 10 ** decimals : undefined,
    codehash,
    beacon,
    genuine: codehash === BEACON_PROXY_CODEHASH && beacon?.toLowerCase() === BEACON,
  }
}

// C. What the shared implementation can do. Look for 4-byte selectors of restriction functions in its bytecode.
const implementation = await client
  .readContract({
    address: BEACON,
    abi: parseAbi(['function implementation() view returns (address)']),
    functionName: 'implementation',
  })
  .catch(() => undefined)
const implCode = implementation ? ((await client.getCode({ address: implementation })) ?? '0x') : '0x'
const probes = [
  'paused()',
  'pause()',
  'unpause()',
  'isRestricted(address)',
  'isBlocked(address)',
  'isBlacklisted(address)',
  'blacklist(address)',
  'isAllowed(address)',
  'isAllowlisted(address)',
  'freeze(address)',
  'isFrozen(address)',
  'forceTransfer(address,address,uint256)',
  'seize(address,address,uint256)',
  'burn(address,uint256)',
  'mint(address,uint256)',
  'uiMultiplier()',
  'balanceOfUI(address)',
  'hasRole(bytes32,address)',
]
const present = probes.filter((sig) => implCode.toLowerCase().includes(toFunctionSelector(sig).slice(2)))

// D. Real swap routes on KyberSwap's aggregator (no key): USDG (6 decimals) → genuine TSLA.
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
const genuineTsla = Object.values(tokens).find(
  (t) => (t as { genuine: boolean; symbol?: string }).genuine && (t as { symbol?: string }).symbol === 'TSLA',
) as { address: string } | undefined
const routes = []
for (const usd of [1, 5, 10, 50]) {
  const res = await fetch(
    `https://aggregator-api.kyberswap.com/robinhood/api/v1/routes?tokenIn=${USDG}&tokenOut=${genuineTsla?.address}&amountIn=${usd * 1e6}`,
  )
  const body = (await res.json()) as {
    data?: {
      routeSummary?: {
        amountOut: string
        amountInUsd: string
        amountOutUsd: string
        gasUsd: string
        route: { exchange: string }[][]
      }
    }
    message?: string
  }
  const r = body.data?.routeSummary
  routes.push(
    r
      ? {
          usd,
          tslaOut: Number(r.amountOut) / 1e18,
          inUsd: Number(r.amountInUsd),
          outUsd: Number(r.amountOutUsd),
          gasUsd: Number(r.gasUsd),
          exchanges: r.route.flat().map((h) => h.exchange),
        }
      : { usd, status: res.status, message: body.message },
  )
}

// E. NEAR Intents: USDC on NEAR → USDG and ETH on Robinhood Chain, delivered to an EVM address.
const intents = []
const PLAYER = '3cae3a05d839587374ef759ecb3b74334634867cdbc911508ddf56ee2b7993dc'
const EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
for (const [label, dest, amount] of [
  [
    '10 USDC NEAR → USDG on Robinhood Chain',
    'nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near',
    '10000000',
  ],
  ['1 USDC NEAR → ETH on Robinhood Chain (gas)', 'nep141:hood.omft.near', '1000000'],
] as const) {
  const res = await fetch('https://1click.chaindefuser.com/v0/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      destinationAsset: dest,
      amount,
      refundTo: PLAYER,
      recipient: EVM,
      depositType: 'ORIGIN_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 600_000).toISOString(),
    }),
  })
  const j = (await res.json()) as { quote?: Record<string, unknown>; message?: string }
  intents.push({
    label,
    status: res.status,
    ...(j.quote
      ? {
          amountOut: j.quote.amountOut,
          amountOutUsd: j.quote.amountOutUsd,
          timeEstimate: j.quote.timeEstimate,
          withdrawFee: j.quote.withdrawFee,
        }
      : { message: j.message }),
  })
}

save('15-robinhood', {
  chain: {
    chainId,
    head: Number(head.number),
    avgBlockMs: Math.round((Number(head.timestamp - back.timestamp) * 1000) / 1000),
    gasPriceGwei: Number(gasPrice) / 1e9,
  },
  tokens,
  implementation,
  restrictionSelectorsPresent: present,
  swapRoutesUsdgToTsla: routes,
  intents,
})

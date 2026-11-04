// 18 · Every genuine Robinhood stock token on Robinhood Chain, and which ones are actually tradeable.
// Candidates: all Robinhood Chain contracts CoinGecko lists. Genuine: the shared beacon proxy codehash and the
// Robinhood beacon in the EIP-1967 beacon slot (spike 15). Liquidity: DexScreener pools; tradeability: a $5 USDG
// route on KyberSwap for the deepest ones. Read-only.
import { createPublicClient, fallback, http, keccak256, parseAbi, type Address } from 'viem'
import { save } from './lib.ts'

const client = createPublicClient({
  transport: fallback([http('https://robinhood-rpc.publicnode.com'), http('https://robinhood.drpc.org')]),
})
const BEACON_PROXY_CODEHASH = '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630'
const BEACON = '0xe10b6f6b275de231345c20d14ab812db62151b00'
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

type Coin = { symbol: string; name: string; platforms?: Record<string, string> }
const coins = (await (
  await fetch('https://api.coingecko.com/api/v3/coins/list?include_platform=true')
).json()) as Coin[]
const candidates = coins
  .map((c) => ({ symbol: c.symbol, name: c.name, address: c.platforms?.robinhood as Address | undefined }))
  .filter((c): c is { symbol: string; name: string; address: Address } => Boolean(c.address))

// Codehash of every candidate, a few at a time (public RPC).
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))))
  return out
}
const hashed = await pool(candidates, 8, async (c) => {
  const code = await client.getCode({ address: c.address }).catch(() => undefined)
  return { ...c, codehash: code ? keccak256(code) : undefined }
})
const sameCode = hashed.filter((c) => c.codehash === BEACON_PROXY_CODEHASH)
const erc20 = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
])
const genuine = (
  await pool(sameCode, 6, async (c) => {
    const slot = await client.getStorageAt({ address: c.address, slot: BEACON_SLOT })
    if (!slot || `0x${slot.slice(26)}` !== BEACON) return undefined
    const [name, symbol, decimals, supply] = await Promise.all([
      client.readContract({ address: c.address, abi: erc20, functionName: 'name' }),
      client.readContract({ address: c.address, abi: erc20, functionName: 'symbol' }),
      client.readContract({ address: c.address, abi: erc20, functionName: 'decimals' }),
      client.readContract({ address: c.address, abi: erc20, functionName: 'totalSupply' }),
    ])
    return { address: c.address, symbol, name, supply: Number(supply) / 10 ** decimals }
  })
).filter((g) => g !== undefined)

// Liquidity per token from DexScreener (30 addresses per request).
const liquidity = new Map<string, { usd: number; pools: number; priceUsd?: number }>()
for (let i = 0; i < genuine.length; i += 30) {
  const batch = genuine.slice(i, i + 30).map((g) => g.address)
  const pairs = (await (await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${batch.join(',')}`)).json()) as {
    baseToken: { address: string }
    quoteToken: { address: string }
    liquidity?: { usd?: number }
    priceUsd?: string
  }[]
  for (const p of pairs) {
    for (const side of [p.baseToken.address, p.quoteToken.address]) {
      const key = side.toLowerCase()
      if (!batch.some((a) => a.toLowerCase() === key)) continue
      const cur = liquidity.get(key) ?? { usd: 0, pools: 0 }
      cur.usd += p.liquidity?.usd ?? 0
      cur.pools += 1
      if (side === p.baseToken.address && p.priceUsd) cur.priceUsd = Number(p.priceUsd)
      liquidity.set(key, cur)
    }
  }
  await new Promise((r) => setTimeout(r, 300))
}

const rows = genuine
  .map((g) => {
    const l = liquidity.get(g.address.toLowerCase())
    return { ...g, liquidityUsd: Math.round(l?.usd ?? 0), pools: l?.pools ?? 0, priceUsd: l?.priceUsd }
  })
  .sort((a, b) => b.liquidityUsd - a.liquidityUsd)

// Can $5 of USDG actually buy it? Check the deepest 25.
const routable: Record<string, unknown> = {}
for (const r of rows.slice(0, 25)) {
  const res = await fetch(
    `https://aggregator-api.kyberswap.com/robinhood/api/v1/routes?tokenIn=${USDG}&tokenOut=${r.address}&amountIn=5000000`,
  )
  const s = ((await res.json()) as { data?: { routeSummary?: { amountOutUsd: string } } }).data?.routeSummary
  routable[r.symbol] = s ? Number(Number(s.amountOutUsd).toFixed(3)) : 'no route'
  await new Promise((r) => setTimeout(r, 300))
}

const fakesClaimingSameName = hashed.filter(
  (c) => c.codehash !== BEACON_PROXY_CODEHASH && /robinhood token/i.test(c.name),
)
save('18-robinhood-stocks', {
  candidatesFromCoinGecko: candidates.length,
  withBeaconProxyCode: sameCode.length,
  genuine: rows.length,
  withLiquidityOver10k: rows.filter((r) => r.liquidityUsd > 10_000).length,
  fakesNamedRobinhoodToken: fakesClaimingSameName.map((f) => ({ name: f.name, address: f.address })),
  fiveDollarUsdgBuy: routable,
  tokens: rows,
})

// 06 · Ondo stock tokens on NEAR (mainnet, read-only): what the contracts say, and whether their price matches
// the real share. Uses the 1Click quote from spike 05 for the token price and Jupiter (spike 07) for the share price.
import { ondoTokens, save, view } from './lib.ts'

const ONDO = await ondoTokens()
const XSTOCK_MINT: Record<string, string> = {
  TSLAon: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
  NVDAon: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  SPYon: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
}
const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'
const PLAYER = '3cae3a05d839587374ef759ecb3b74334634867cdbc911508ddf56ee2b7993dc'

// Real share price from Jupiter's stockData (spike 07 checks the API itself).
const jup = (await (
  await fetch(`https://lite-api.jup.ag/price/v3?ids=${Object.values(XSTOCK_MINT).join(',')}`)
).json()) as Record<string, { stockData?: { price: number } }>

const out: Record<string, unknown> = {}
for (const [symbol, id] of Object.entries(ONDO)) {
  const meta = await view<{ name: string; symbol: string; decimals: number }>('mainnet', id, 'ft_metadata')
  const supply = await view<string>('mainnet', id, 'ft_total_supply')
  const storage = await view<{ min: string }>('mainnet', id, 'storage_balance_bounds').catch((e: unknown) => String(e))
  const res = await fetch('https://1click.chaindefuser.com/v0/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: USDC,
      destinationAsset: `nep141:${id}`,
      amount: '50000000',
      refundTo: PLAYER,
      recipient: PLAYER,
      recipientType: 'INTENTS',
      depositType: 'ORIGIN_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      deadline: new Date(Date.now() + 600_000).toISOString(),
      quoteWaitingTimeMs: 6000,
    }),
  })
  const q = ((await res.json()) as { quote?: { amountOut: string; amountInUsd: string } }).quote
  const tokensOut = q ? Number(q.amountOut) / 10 ** meta.decimals : undefined
  const tokenPrice = q && tokensOut ? Number(q.amountInUsd) / tokensOut : undefined
  const share = jup[XSTOCK_MINT[symbol]!]?.stockData?.price
  out[symbol] = {
    metadata: { name: meta.name, symbol: meta.symbol, decimals: meta.decimals },
    totalSupply: Number(supply) / 10 ** meta.decimals,
    storageMinYocto: storage,
    quote50Usdc: q ? { tokensOut, impliedTokenPriceUsd: tokenPrice } : 'no liquidity',
    sharePriceUsd: share,
    tokenVsShare: tokenPrice && share ? `${((tokenPrice / share - 1) * 100).toFixed(2)} %` : undefined,
  }
}
save('06-ondo', out)

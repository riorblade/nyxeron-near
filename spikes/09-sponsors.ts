// 09 · Hackathon sponsors that could matter to us (mainnet, read-only):
// - Rhea (NEAR DEX): any pools with Ondo stock tokens or USDC → a second source of liquidity besides Intents?
// - OutLayer price oracle (price-oracle.near): any stock prices on-chain?
// - NEAR AI Cloud: which models are there (for AI guests/NPCs, if ever)?
import { save, view } from './lib.ts'

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'
const ONDO_TSLA = 'bnb-0x2494b603319d4d9f9715c9f4496d9e0364b59d93.omdep.near'
const ONDO_NVDA = 'bnb-0xa9ee28c80f960b889dfbd1902055218cba016f75.omdep.near'
const ONDO_SPY = 'bnb-0x6a708ead771238919d85930b5a0f10454e1c331a.omdep.near'

// Rhea's indexer serves compressed JSON; fetch() decompresses it.
type Pool = { id: string; token_account_ids: string[]; token_symbols?: string[]; tvl?: string; pool_kind?: string }
const pools = (await (await fetch('https://indexer.ref.finance/list-top-pools')).json()) as Pool[]
const ondoPools = pools.filter((p) => p.token_account_ids.some((t) => [ONDO_TSLA, ONDO_NVDA, ONDO_SPY].includes(t)))
const usdcPools = pools
  .filter((p) => p.token_account_ids.includes(USDC))
  .sort((a, b) => Number(b.tvl ?? 0) - Number(a.tvl ?? 0))
  .slice(0, 5)

// OutLayer oracle: free view `get_price_data` by asset id (21 crypto tokens per its docs). Ask for NEAR and Ondo Tesla.
const oracle = async (ids: string[]) =>
  view<unknown>('mainnet', 'price-oracle.near', 'get_price_data', { asset_ids: ids }).catch((e: unknown) =>
    String(e).slice(0, 300),
  )
const nearPrice = await oracle(['wrap.near'])
const tslaPrice = await oracle([ONDO_TSLA])
const listedText = JSON.stringify({ nearPrice, tslaPrice })

const models = (await (await fetch('https://cloud-api.near.ai/v1/models')).json()) as {
  data: { id: string; owned_by?: string; pricing?: unknown }[]
}

save('09-sponsors', {
  rhea: {
    poolsListed: pools.length,
    ondoPools: ondoPools.map((p) => ({ id: p.id, tokens: p.token_symbols ?? p.token_account_ids, tvl: p.tvl })),
    topUsdcPools: usdcPools.map((p) => ({ id: p.id, tokens: p.token_symbols ?? p.token_account_ids, tvl: p.tvl })),
  },
  outlayerOracle: {
    wrapNear: nearPrice,
    ondoTesla: tslaPrice,
    raw: listedText.slice(0, 600),
  },
  nearAiCloud: {
    modelCount: models.data.length,
    models: models.data.map((m) => m.id),
  },
})

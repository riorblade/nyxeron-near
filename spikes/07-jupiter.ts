// 07 · Jupiter (Solana, read-only): price API old vs new host, and a swap order USDC → TSLAx for a taker address,
// to see the route and the unsigned transaction size (Chain Signatures signs at most 1232 bytes, spike 08).
import { save } from './lib.ts'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB'
const TAKER = 'GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ' // any valid address; nothing is signed or sent

async function get(url: string) {
  const t = performance.now()
  const res = await fetch(url)
  const text = await res.text()
  let body: unknown = text.slice(0, 300)
  try {
    body = JSON.parse(text)
  } catch {
    /* not JSON: keep the text */
  }
  return { url, status: res.status, ms: Math.round(performance.now() - t), body }
}

const priceLite = await get(`https://lite-api.jup.ag/price/v3?ids=${TSLAX}`)
const priceApi = await get(`https://api.jup.ag/price/v3?ids=${TSLAX}`)

const order = async (usd: number) => {
  const r = await get(
    `https://api.jup.ag/swap/v2/order?inputMint=${USDC}&outputMint=${TSLAX}&amount=${usd * 1e6}&taker=${TAKER}`,
  )
  const b = r.body as Record<string, unknown>
  const tx = typeof b?.transaction === 'string' ? Buffer.from(b.transaction, 'base64') : undefined
  return {
    usd,
    status: r.status,
    ms: r.ms,
    outAmount: b?.outAmount,
    priceImpactPct: b?.priceImpactPct,
    router: b?.router ?? b?.swapType,
    routes: Array.isArray(b?.routePlan)
      ? (b.routePlan as { swapInfo?: { label?: string } }[]).map((x) => x.swapInfo?.label)
      : undefined,
    txBytes: tx?.length,
    lastValidBlockHeight: b?.lastValidBlockHeight,
    error: b?.error ?? b?.errorMessage ?? (r.status >= 400 ? r.body : undefined),
  }
}
const orders = [await order(1), await order(5)]

const item = (p: { body: unknown }) => (p.body as Record<string, Record<string, unknown>>)?.[TSLAX]
save('07-jupiter', {
  priceLite: { status: priceLite.status, ms: priceLite.ms, item: item(priceLite) },
  priceApi: { status: priceApi.status, ms: priceApi.ms, item: item(priceApi) ?? priceApi.body },
  swapOrders: orders,
})

// 05 · NEAR Intents 1Click (mainnet, dry quotes only: nothing is sent, no deposit address is created).
// Top-up into a player's own NEAR account, cash-out, Ondo stock tokens, small amounts (one drink ≈ $0.40),
// the intents.near balance, delivery into a contract with ft_transfer_call, and funding a Solana address.
import { save } from './lib.ts'

const API = 'https://1click.chaindefuser.com/v0'
// A real ed25519 implicit id (the zero-NEAR player from spike 04). 'fff…f' is refused: 1Click checks it is a valid key.
const PLAYER = '3cae3a05d839587374ef759ecb3b74334634867cdbc911508ddf56ee2b7993dc'
// An ordinary EVM address; 1Click refuses the 0x…dEaD burn address.
const EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
const SOLANA = 'GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ' // a valid base58 address, no funds involved

type Token = { assetId: string; symbol: string; blockchain: string; decimals: number; price?: number }
const tokens = (await (await fetch(`${API}/tokens`)).json()) as Token[]
const find = (blockchain: string, symbol: string) =>
  tokens.find((t) => t.blockchain === blockchain && t.symbol === symbol)

const USDC_NEAR = find('near', 'USDC')!.assetId
const USDC_BASE = find('base', 'USDC')!.assetId
const SOL = find('sol', 'SOL')!.assetId
const USDC_SOL = find('sol', 'USDC')!.assetId
const TSLAON = 'nep141:bnb-0x2494b603319d4d9f9715c9f4496d9e0364b59d93.omdep.near' // Ondo Tesla, not in /v0/tokens

async function quote(name: string, body: Record<string, unknown>) {
  const t = performance.now()
  const res = await fetch(`${API}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      depositType: 'ORIGIN_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      quoteWaitingTimeMs: 3000,
      ...body,
    }),
  })
  const json = (await res.json()) as { quote?: Record<string, unknown>; message?: string }
  const q = json.quote
  return {
    name,
    status: res.status,
    ms: Math.round(performance.now() - t),
    ...(q
      ? {
          amountIn: q.amountIn,
          amountInUsd: q.amountInUsd,
          amountOut: q.amountOut,
          amountOutUsd: q.amountOutUsd,
          minAmountOut: q.minAmountOut,
          timeEstimate: q.timeEstimate,
          withdrawFee: q.withdrawFee,
          refundFee: q.refundFee,
          appFees: q.appFees,
        }
      : { message: json.message ?? JSON.stringify(json).slice(0, 300) }),
  }
}

const usdc = (n: number) => String(Math.round(n * 1e6))
const results = [
  await quote('top-up 10 USDC Base → USDC in player account', {
    originAsset: USDC_BASE,
    destinationAsset: USDC_NEAR,
    amount: usdc(10),
    refundTo: EVM,
    recipient: PLAYER,
  }),
  await quote('top-up 0.1 SOL → USDC in player account', {
    originAsset: SOL,
    destinationAsset: USDC_NEAR,
    amount: '100000000',
    refundTo: SOLANA,
    recipient: PLAYER,
  }),
  await quote('top-up 10 USDC Base → player intents.near balance', {
    originAsset: USDC_BASE,
    destinationAsset: USDC_NEAR,
    amount: usdc(10),
    refundTo: EVM,
    recipient: PLAYER,
    recipientType: 'INTENTS',
  }),
  await quote('top-up 10 USDC Base → contract via ft_transfer_call (customRecipientMsg)', {
    originAsset: USDC_BASE,
    destinationAsset: USDC_NEAR,
    amount: usdc(10),
    refundTo: EVM,
    recipient: 'intents.near',
    customRecipientMsg: JSON.stringify({ receiver_id: PLAYER }),
  }),
  await quote('cash-out 10 USDC from player account → USDC Base', {
    originAsset: USDC_NEAR,
    destinationAsset: USDC_BASE,
    amount: usdc(10),
    refundTo: PLAYER,
    recipient: EVM,
  }),
  // Ondo tokens are bridged in: DESTINATION_CHAIN means withdrawing to their origin chain, so to hold them on NEAR
  // the output goes to the player's intents.near balance.
  ...(await Promise.all(
    [10, 1, 0.4].map((n) =>
      quote(`buy Ondo Tesla with ${n} USDC → player intents.near balance`, {
        originAsset: USDC_NEAR,
        destinationAsset: TSLAON,
        amount: usdc(n),
        refundTo: PLAYER,
        recipient: PLAYER,
        recipientType: 'INTENTS',
      }),
    ),
  )),
  await quote('sell 0.01 Ondo Tesla from intents balance → USDC in player account', {
    originAsset: TSLAON,
    destinationAsset: USDC_NEAR,
    amount: String(10n ** 16n), // 18 decimals; spike 06 checks
    depositType: 'INTENTS',
    refundType: 'INTENTS',
    refundTo: PLAYER,
    recipient: PLAYER,
  }),
  await quote('buy Ondo Tesla, DESTINATION_CHAIN to an EVM address (= withdraw off NEAR)', {
    originAsset: USDC_NEAR,
    destinationAsset: TSLAON,
    amount: usdc(10),
    refundTo: PLAYER,
    recipient: EVM,
  }),
  await quote('fund Solana: 10 USDC NEAR → USDC Solana', {
    originAsset: USDC_NEAR,
    destinationAsset: USDC_SOL,
    amount: usdc(10),
    refundTo: PLAYER,
    recipient: SOLANA,
  }),
  await quote('fund Solana: 1 USDC NEAR → SOL (fees)', {
    originAsset: USDC_NEAR,
    destinationAsset: SOL,
    amount: usdc(1),
    refundTo: PLAYER,
    recipient: SOLANA,
  }),
]

// Where does Ondo liquidity start? Buys from $2 to $50, sells from 0.005 to 0.1 TSLAon (≈ $2 to $40).
const ondoBuys = await Promise.all(
  [2, 3, 5, 7, 20, 50].map((n) =>
    quote(`buy Ondo Tesla with ${n} USDC`, {
      originAsset: USDC_NEAR,
      destinationAsset: TSLAON,
      amount: usdc(n),
      refundTo: PLAYER,
      recipient: PLAYER,
      recipientType: 'INTENTS',
    }),
  ),
)
const ondoSells = await Promise.all(
  ['0.005', '0.026', '0.05', '0.1'].map((n) =>
    quote(`sell ${n} Ondo Tesla`, {
      originAsset: TSLAON,
      destinationAsset: USDC_NEAR,
      amount: String(BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n),
      depositType: 'INTENTS',
      refundType: 'INTENTS',
      refundTo: PLAYER,
      recipient: PLAYER,
      recipientType: 'INTENTS',
    }),
  ),
)
results.push(...ondoBuys, ...ondoSells)

const stockLike = tokens.filter((t) => /(^|[^a-z])(TSLA|NVDA|SPY|AAPL|QQQ|MSFT|GOOGL|AMZN)/i.test(t.symbol))
save('05-intents', {
  tokenCount: tokens.length,
  stockTokensListed: stockLike.map((t) => `${t.symbol}@${t.blockchain}`),
  assets: { USDC_NEAR, USDC_BASE, SOL, USDC_SOL, TSLAON },
  quotes: results,
})

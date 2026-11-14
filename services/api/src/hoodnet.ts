// Which Robinhood Chain the warehouse buys on. Mainnet: Robinhood's own USDG and stock tokens through KyberSwap.
// Testnet (chain 46630): none of those exist there, so the team deployed test dollars, synthetic stocks and a market
// that takes Kyber's `swap` call (contracts/hood-testnet). Same buyer, same checks, different addresses.
import { ROBINHOOD_CHAIN_ID, type TokenId, tokenIds, tokens } from '@nyxeron/game'
import { type Address, getAddress } from 'viem'
import { HOOD_TESTNET_DEPLOY } from './hood-testnet.ts'

export type HoodNet = {
  name: 'mainnet' | 'testnet'
  chainId: number
  rpcs: readonly string[]
  explorer: string
  /** What the warehouse pays with (6 decimals). */
  usdg: Address
  /** The only contract the warehouse calls, and the only spender it approves. */
  router: Address
  /** The stock token the warehouse holds for each menu item. */
  tokens: Record<TokenId, Address>
  /** Testnet: test dollars and synthetic stocks, worth nothing. */
  synthetic: boolean
}

// Robinhood's own RPC domain is ISP-blocked in Indonesia (spike 15); these public ones answer.
export const ROBINHOOD_RPCS = ['https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org']

export const HOOD_MAINNET: HoodNet = {
  name: 'mainnet',
  chainId: ROBINHOOD_CHAIN_ID,
  rpcs: ROBINHOOD_RPCS,
  // Unchecked: robinhood.com is ISP-blocked where this was written (spike 15). The testnet explorer answers.
  explorer: 'https://explorer.chain.robinhood.com',
  // Robinhood's USDG, and KyberSwap's router on Robinhood Chain (its /routes answer, 2026-11-05).
  usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  router: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
  tokens: Object.fromEntries(tokenIds.map((id) => [id, tokens[id].address as Address])) as Record<TokenId, Address>,
  synthetic: false,
}

export const HOOD_TESTNET_CHAIN_ID = 46630

export type HoodTestnetDeploy = {
  usdg: string
  market: string
  tokens: Record<TokenId, string>
}

/** The testnet profile, or undefined while nothing is deployed there (testnet parties then keep `demo:` proofs). */
export function hoodTestnet(deploy: HoodTestnetDeploy | null = HOOD_TESTNET_DEPLOY): HoodNet | undefined {
  if (!deploy) return undefined
  const missing = tokenIds.filter((id) => !deploy.tokens[id])
  if (missing.length) throw new Error(`hood-testnet.ts lacks ${missing.join(', ')}`)
  return {
    name: 'testnet',
    chainId: HOOD_TESTNET_CHAIN_ID,
    rpcs: ['https://rpc.testnet.chain.robinhood.com'],
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    usdg: getAddress(deploy.usdg),
    router: getAddress(deploy.market),
    tokens: Object.fromEntries(tokenIds.map((id) => [id, getAddress(deploy.tokens[id])])) as Record<TokenId, Address>,
    synthetic: true,
  }
}

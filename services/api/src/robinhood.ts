import { ROBINHOOD_CHAIN_ID, type TokenId, tokenIds, tokens } from '@nyxeron/game'
import { createPublicClient, fallback, http, keccak256, type Address, type Hex } from 'viem'

// Genuine Robinhood stock tokens share one beacon-proxy bytecode and point at Robinhood's beacon (spikes 15, 18).
export const BEACON_PROXY_CODEHASH = '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630'
export const BEACON = '0xe10b6f6b275de231345c20d14ab812db62151b00'
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50' // EIP-1967

// Robinhood's own RPC domain is ISP-blocked in Indonesia (spike 15); these public ones answer.
export const ROBINHOOD_RPCS = ['https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org']

export type ChainReader = {
  getCode(address: Address): Promise<Hex | undefined>
  getStorageAt(address: Address, slot: Hex): Promise<Hex | undefined>
}

export function robinhoodReader(): ChainReader {
  const client = createPublicClient({
    transport: fallback(ROBINHOOD_RPCS.map((url) => http(url, { timeout: 10_000 }))),
  })
  return {
    getCode: (address) => client.getCode({ address }),
    getStorageAt: (address, slot) => client.getStorageAt({ address, slot }),
  }
}

export async function isGenuine(reader: ChainReader, address: Address): Promise<boolean> {
  const code = await reader.getCode(address)
  if (!code || keccak256(code) !== BEACON_PROXY_CODEHASH) return false
  const slot = await reader.getStorageAt(address, BEACON_SLOT)
  return Boolean(slot) && `0x${slot!.slice(26)}`.toLowerCase() === BEACON
}

// Run at start: a pinned token that fails the check is never priced or sold.
export async function verifyMenu(reader: ChainReader): Promise<{ ok: TokenId[]; failed: TokenId[] }> {
  const results = await Promise.all(
    tokenIds.map(async (id) => [id, await isGenuine(reader, tokens[id].address)] as const),
  )
  return {
    ok: results.filter(([, good]) => good).map(([id]) => id),
    failed: results.filter(([, good]) => !good).map(([id]) => id),
  }
}

export { ROBINHOOD_CHAIN_ID }

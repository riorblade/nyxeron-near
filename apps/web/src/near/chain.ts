import { FailoverRpcProvider, JsonRpcProvider, type Provider } from 'near-api-js'

// The same public RPCs the api uses, with failover (one free endpoint rate-limits after a few dozen calls).
const RPCS = {
  mainnet: ['https://free.rpc.fastnear.com', 'https://near.drpc.org'],
  testnet: ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org'],
} as const

export type Network = keyof typeof RPCS

const providers: Partial<Record<Network, Provider>> = {}

export function nearProvider(network: Network): Provider {
  return (providers[network] ??= new FailoverRpcProvider(RPCS[network].map((url) => new JsonRpcProvider({ url }))))
}

/** NEP-141 balance in the token's smallest unit (micro-USDC for USDC). 0 when the account isn't registered yet. */
export async function tokenBalance(provider: Provider, token: string, account: string): Promise<number> {
  const raw = await provider.callFunction<string>({
    contractId: token,
    method: 'ft_balance_of',
    args: { account_id: account },
  })
  return Number(raw ?? 0)
}

export const explorer = (network: Network) =>
  network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'

/** A read-only contract call; undefined when the method doesn't exist on the deployed contract yet. */
export async function view<T>(
  provider: Provider,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
) {
  try {
    return (await provider.callFunction<T & object>({ contractId, method, args })) as T | undefined
  } catch (e) {
    if (/MethodNotFound|CodeDoesNotExist|wasm execution failed with error: MethodResolveError/i.test(String(e)))
      return undefined
    throw e
  }
}

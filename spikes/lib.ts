// Shared bits for the spike scripts. Run any spike with: node spikes/<nn>-<name>.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FailoverRpcProvider, JsonRpcProvider } from 'near-api-js'

const here = dirname(fileURLToPath(import.meta.url))
const envFile = join(here, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

// Public RPCs from https://docs.near.org/api/rpc/providers. One free endpoint hits its rate limit within a few dozen
// calls (spike 03), so every call fails over to the next.
export const RPC = {
  mainnet: [
    'https://free.rpc.fastnear.com',
    'https://near.drpc.org',
    'https://rpc.mainnet.near.org',
    'https://rpc.intea.rs',
  ],
  testnet: [
    'https://test.rpc.fastnear.com',
    'https://near-testnet.drpc.org',
    'https://rpc.testnet.near.org',
    'https://testnet-rpc.intea.rs',
  ],
} as const
export type Network = keyof typeof RPC

export const provider = (network: Network) =>
  new FailoverRpcProvider(RPC[network].map((url) => new JsonRpcProvider({ url })))

// Raw JSON-RPC, for methods the library doesn't wrap.
export async function rpc<T>(network: Network, method: string, params: unknown): Promise<T> {
  let last: unknown
  for (const url of RPC[network]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      })
      const body = (await res.json()) as { result?: T; error?: unknown }
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`)
      return body.result as T
    } catch (err) {
      last = err
    }
  }
  throw last
}

export async function view<T>(
  network: Network,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return provider(network).callFunction({ contractId, method, args }) as Promise<T>
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t = performance.now()
  const value = await fn()
  return { ms: Math.round(performance.now() - t), value }
}

// Every spike saves what it saw to spikes/results/<name>.json (committed: evidence for FINDINGS.md, never secrets).
export function save(name: string, data: unknown): void {
  const dir = join(here, 'results')
  mkdirSync(dir, { recursive: true })
  const out = { spike: name, ranAt: new Date().toISOString(), ...(data as object) }
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(out, null, 2) + '\n')
  console.log(JSON.stringify(out, null, 2))
}

export function needEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} missing: run 02-testnet-account.ts first`)
  return v
}

// Guard for anything that spends real money: runs only with --live and an explicit team yes.
export function requireLive(what: string): void {
  if (!process.argv.includes('--live')) {
    console.log(`skipped (needs --live and the team's yes): ${what}`)
    process.exit(0)
  }
}

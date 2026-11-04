// 01 · NEAR RPC: protocol version, block time and how long a block takes to become final, on both networks.
import { type Network, rpc, save, timed } from './lib.ts'

type Status = { version: { version: string }; protocol_version: number; sync_info: { latest_block_height: number } }
type Block = { header: { height: number; timestamp_nanosec: string } }

async function measure(network: Network) {
  const status = await rpc<Status>(network, 'status', [])
  const head = await rpc<Block>(network, 'block', { finality: 'optimistic' })
  const final = await rpc<Block>(network, 'block', { finality: 'final' })
  const back = await rpc<Block>(network, 'block', { block_id: head.header.height - 200 })
  const avgBlockMs = (Number(head.header.timestamp_nanosec) - Number(back.header.timestamp_nanosec)) / 200 / 1e6
  const ping = await timed(() => rpc(network, 'block', { finality: 'final' }))
  return {
    binary: status.version.version,
    protocol: status.protocol_version,
    head: head.header.height,
    blocksBehindFinal: head.header.height - final.header.height,
    avgBlockMs: Math.round(avgBlockMs),
    finalityMsApprox: Math.round(avgBlockMs * (head.header.height - final.header.height + 1)),
    rpcRoundTripMs: ping.ms,
  }
}

save('01-near-rpc', { mainnet: await measure('mainnet'), testnet: await measure('testnet') })

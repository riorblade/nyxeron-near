import { tokens } from '@nyxeron/game'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { BEACON, type ChainReader, isGenuine, verifyMenu } from './robinhood.ts'

// Runtime code of Robinhood's beacon proxy, read from TSLA on Robinhood Chain on 2026-11-04 (283 bytes). It hashes to
// BEACON_PROXY_CODEHASH, so the real check runs without the network.
const PROXY_CODE: Hex =
  '0x6080604052600a600c565b005b60186014601a565b609d565b565b5f7f000000000000000000000000e10b6f6b275de231345c20d14ab812db62151b006001600160a01b0316635c60da1b6040518163ffffffff1660e01b8152600401602060405180830381865afa1580156076573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906098919060ba565b905090565b365f5f375f5f365f845af43d5f5f3e80801560b6573d5ff35b3d5ffd5b5f6020828403121560c9575f5ffd5b81516001600160a01b038116811460de575f5ffd5b939250505056fea2646970667358221220e296a217a10765339b402e91ead95bcbcf74e678d7c756705f097d88cc2554b064736f6c63430008210033'
const beaconWord = (beacon: string) => `0x000000000000000000000000${beacon.slice(2)}` as Hex

function reader(map: Record<string, { code?: Hex; beacon?: Hex }>): ChainReader {
  return {
    async getCode(a: Address) {
      return map[a.toLowerCase()]?.code
    },
    async getStorageAt(a: Address) {
      return map[a.toLowerCase()]?.beacon
    },
  }
}

const tsla = tokens.tsla.address.toLowerCase()

describe('isGenuine', () => {
  it('accepts the beacon proxy pointing at Robinhood’s beacon', async () => {
    expect(
      await isGenuine(reader({ [tsla]: { code: PROXY_CODE, beacon: beaconWord(BEACON) } }), tokens.tsla.address),
    ).toBe(true)
  })

  it('refuses a byte-identical clone pointing at another beacon', async () => {
    const other = beaconWord(`0x${'ab'.repeat(20)}`)
    expect(await isGenuine(reader({ [tsla]: { code: PROXY_CODE, beacon: other } }), tokens.tsla.address)).toBe(false)
  })

  it('refuses an address with no code or other code', async () => {
    expect(await isGenuine(reader({}), tokens.tsla.address)).toBe(false)
    expect(
      await isGenuine(reader({ [tsla]: { code: '0x6080604052', beacon: beaconWord(BEACON) } }), tokens.tsla.address),
    ).toBe(false)
  })
})

describe('verifyMenu', () => {
  it('splits the menu into tokens that passed and tokens that failed', async () => {
    const nvda = tokens.nvda.address.toLowerCase()
    const result = await verifyMenu(
      reader({
        [tsla]: { code: PROXY_CODE, beacon: beaconWord(BEACON) },
        [nvda]: { code: PROXY_CODE, beacon: beaconWord(BEACON) },
      }),
    )
    expect(result.ok).toEqual(['tsla', 'nvda'])
    expect(result.failed).toHaveLength(8)
  })
})

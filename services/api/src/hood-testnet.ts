// Written by scripts/deploy-hood-testnet.ts on 2026-11-14 (Robinhood Chain testnet, chain 46630).
// Warehouse (price poster, holds the test dollars): 0xa7175f62675ec1B780577944E545047df0d74323.
import type { HoodTestnetDeploy } from './hoodnet.ts'

export const HOOD_TESTNET_DEPLOY: HoodTestnetDeploy | null = {
  usdg: '0x7bcdb2de027efb565b01d42a28fb95b9a3db2ac9',
  market: '0xa7dcd7d0494d046dfb1a99d1587574d9dd0c26e1',
  tokens: {
    tsla: '0x24eab92d2196526402117e9b5962af90feaa9b2c',
    nvda: '0x2080afb355e976d2e6b4fcd2ed9bcdcb260cfcf0',
    aapl: '0x6bb25bfa66b68ed023f447f36fd0f865b498606f',
    googl: '0x30f7ef6583beea814e349d4c1b2645631c1cee8c',
    meta: '0x62e9bb74674b0283da912c086ba92e5c2891b449',
    msft: '0x71fa75ddbc03d025ca48158e7f7d63eeb66f5b17',
    spy: '0x6d137a382f53a7721703b58b1c66c58eed743672',
    qqq: '0x17a1a07dfdced9bc89a86dfb1956959352525b0b',
    crcl: '0xf742cedf699a76ebde9f63f809ba4491573acae3',
    mstr: '0xc65be86ecc9e0c9d961528a95687fd538c37b402',
  },
}

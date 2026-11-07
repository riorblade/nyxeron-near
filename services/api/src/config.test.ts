import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.ts'

const base = { PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret' }

describe('loadConfig', () => {
  it('fills defaults and normalises owner emails', () => {
    const cfg = loadConfig({ ...base, OWNER_EMAILS: ' Kiel@Example.com, ,b@x.io' })
    expect(cfg.PORT).toBe(8788)
    expect(cfg.NEAR_NETWORK).toBe('testnet')
    expect(cfg.DEMO_MODE).toBe(false)
    expect(cfg.OWNER_EMAILS).toEqual(['kiel@example.com', 'b@x.io'])
  })

  it('stops the server when the Privy app is missing', () => {
    expect(() => loadConfig({})).toThrow(/PRIVY_APP_ID/)
  })

  it('never allows demo credits on mainnet', () => {
    expect(loadConfig({ ...base, DEMO_MODE: 'true' }).DEMO_MODE).toBe(true)
    expect(() => loadConfig({ ...base, DEMO_MODE: 'true', NEAR_NETWORK: 'mainnet' })).toThrow(/mainnet/)
  })
})

describe('relayer config', () => {
  it('defaults the contract and USDC for the network', () => {
    const cfg = loadConfig(base)
    expect(cfg.CONTRACT_ID).toBe('nyxeron.testnet')
    expect(cfg.USDC_CONTRACT_ID).toBe('3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af')
    expect(cfg.RELAYER_ACCOUNT_ID).toBeUndefined()
  })

  it('needs the relayer account and key together, and the contract on mainnet', () => {
    expect(() => loadConfig({ ...base, RELAYER_ACCOUNT_ID: 'relayer.testnet' })).toThrow(/together/)
    expect(() => loadConfig({ ...base, NEAR_NETWORK: 'mainnet' })).toThrow(/CONTRACT_ID/)
    expect(loadConfig({ ...base, NEAR_NETWORK: 'mainnet', CONTRACT_ID: 'nyxeron.near' }).USDC_CONTRACT_ID).toBe(
      '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    )
  })
})

describe('owner, test dollars and blank lines', () => {
  it('needs the owner account and key together; test dollars default to $3', () => {
    expect(() => loadConfig({ ...base, OWNER_ACCOUNT_ID: 'nyxeron-api.testnet' })).toThrow(/together/)
    expect(() => loadConfig({ ...base, WAREHOUSE_ACCOUNT_ID: 'nyxeron-warehouse.near' })).toThrow(/together/)
    expect(() => loadConfig({ ...base, WAREHOUSE_KEY: 'ed25519:x' })).toThrow(/together/)
    expect(loadConfig(base).TEST_DOLLARS).toBe(3_000_000)
    expect(() => loadConfig({ ...base, TEST_DOLLARS: '0' })).toThrow(/TEST_DOLLARS/)
  })

  it('treats a blank line from .env.example (KEY=) as not set', () => {
    const cfg = loadConfig({ ...base, RELAYER_ACCOUNT_ID: '', RELAYER_KEY: '', OWNER_KEY: '', CONTRACT_ID: '' })
    expect(cfg.RELAYER_ACCOUNT_ID).toBeUndefined()
    expect(cfg.CONTRACT_ID).toBe('nyxeron.testnet')
  })
})

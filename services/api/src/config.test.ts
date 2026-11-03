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

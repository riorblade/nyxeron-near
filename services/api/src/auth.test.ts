import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { parseProfile, privyIdentity } from './auth.ts'

async function keys() {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' }
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) }
}

const sign = (key: CryptoKey, claims: { iss?: string; aud?: string; sub?: string; exp?: string }) =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(claims.iss ?? 'privy.io')
    .setAudience(claims.aud ?? 'app')
    .setSubject(claims.sub ?? 'did:privy:alice')
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? '1h')
    .sign(key)

describe('privyIdentity.verify', () => {
  it('accepts a token Privy signed for this app', async () => {
    const { privateKey, jwks } = await keys()
    const id = privyIdentity('app', 'secret', { jwks })
    expect(await id.verify(await sign(privateKey, {}))).toBe('did:privy:alice')
  })

  it('refuses another app, another issuer, an expired token, and a key it does not know', async () => {
    const { privateKey, jwks } = await keys()
    const id = privyIdentity('app', 'secret', { jwks })
    await expect(id.verify(await sign(privateKey, { aud: 'other-app' }))).rejects.toThrow()
    await expect(id.verify(await sign(privateKey, { iss: 'evil.io' }))).rejects.toThrow()
    await expect(id.verify(await sign(privateKey, { exp: '-1m' }))).rejects.toThrow()
    const stranger = await keys()
    await expect(id.verify(await sign(stranger.privateKey, {}))).rejects.toThrow()
  })
})

describe('privyIdentity.profile', () => {
  it('asks Privy with the app secret and reads the NEAR wallet', async () => {
    let seen: Request | undefined
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = new Request(url, init)
      return Response.json({
        linked_accounts: [{ type: 'wallet', chain_type: 'near', address: 'f'.repeat(64) }],
      })
    }) as typeof fetch
    const id = privyIdentity('app', 'secret', { fetch: fakeFetch })
    expect(await id.profile('did:privy:alice')).toEqual({ email: '', nearAccount: 'f'.repeat(64) })
    expect(seen!.url).toBe('https://auth.privy.io/api/v1/users/did%3Aprivy%3Aalice')
    expect(seen!.headers.get('authorization')).toBe(`Basic ${btoa('app:secret')}`)
    expect(seen!.headers.get('privy-app-id')).toBe('app')
  })
})

describe('parseProfile', () => {
  it('takes the email login over Google, lowercased', () => {
    const p = parseProfile({
      linked_accounts: [
        { type: 'google_oauth', email: 'g@gmail.com' },
        { type: 'email', address: 'Kiel@Example.COM' },
      ],
    })
    expect(p.email).toBe('kiel@example.com')
  })

  it('falls back to the Google email', () => {
    expect(parseProfile({ linked_accounts: [{ type: 'google_oauth', email: 'g@gmail.com' }] }).email).toBe(
      'g@gmail.com',
    )
  })

  it('takes only a NEAR wallet, never an Ethereum one, and only a valid account id', () => {
    const near = 'a1'.repeat(32)
    const accounts = [
      { type: 'wallet', chain_type: 'ethereum', address: '0xabc' },
      { type: 'wallet', chain_type: 'near', address: near },
    ]
    expect(parseProfile({ linked_accounts: accounts }).nearAccount).toBe(near)
    expect(
      parseProfile({ linked_accounts: [{ type: 'wallet', chain_type: 'near', address: 'NOT VALID' }] }).nearAccount,
    ).toBe('')
    expect(
      parseProfile({ linked_accounts: [{ type: 'wallet', chain_type: 'near', address: 'team.near' }] }).nearAccount,
    ).toBe('team.near')
  })

  it('refuses an answer that is not a Privy user', () => {
    expect(() => parseProfile({ nope: true })).toThrow()
  })
})

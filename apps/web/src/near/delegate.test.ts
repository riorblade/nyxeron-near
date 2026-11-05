import { actions, buildDelegateAction, KeyPair, keyToImplicitAddress } from 'near-api-js'
import { describe, expect, it } from 'vitest'
// The api's own decoder and checks: what the browser sends must pass them unchanged.
import { checkDelegate, decodeDelegate, signatureValid } from '../../../../services/api/src/relay.ts'
import { fromHex, implicitKey, type SignHash, signDelegate, toHex } from './delegate.ts'

const USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'
const CONTRACT = 'nyxeron.testnet'

function player() {
  const key = KeyPair.fromRandom('ed25519')
  const account = keyToImplicitAddress(key.getPublicKey())
  // Same shape as Privy's signRawHash: 0x-hex hash in, 0x-hex signature out.
  const sign: SignHash = async (hash) => toHex(key.sign(fromHex(hash)).signature)
  return { account, sign }
}

function payment(sender: string, receiver = CONTRACT) {
  return buildDelegateAction({
    senderId: sender,
    receiverId: USDC,
    nonce: 7n,
    maxBlockHeight: 1000n,
    publicKey: implicitKey(sender),
    actions: [
      actions.functionCall(
        'ft_transfer_call',
        { receiver_id: receiver, amount: '410000', msg: '{}' },
        100_000_000_000_000n,
        1n,
      ),
    ],
  })
}

describe('signDelegate', () => {
  it('produces a delegate the api decodes, allows and verifies', async () => {
    const { account, sign } = player()
    const d = decodeDelegate(await signDelegate(payment(account), sign))
    expect(d.delegateAction.senderId).toBe(account)
    expect(checkDelegate(d, { sender: account, contractId: CONTRACT, usdcId: USDC })).toBeUndefined()
    expect(signatureValid(d)).toBe(true)
  })

  it('is refused when signed by another key', async () => {
    const { account } = player()
    const other = player()
    const d = decodeDelegate(await signDelegate(payment(account), other.sign))
    expect(signatureValid(d)).toBe(false)
  })

  it('is refused by the api when paying anyone but our contract', async () => {
    const { account, sign } = player()
    const d = decodeDelegate(await signDelegate(payment(account, 'thief.testnet'), sign))
    expect(checkDelegate(d, { sender: account, contractId: CONTRACT, usdcId: USDC })).toBe('receiver_not_allowed')
  })

  it('rejects a signature that is not 64 bytes', async () => {
    const { account } = player()
    await expect(signDelegate(payment(account), async () => '0x1234')).rejects.toThrow('64-byte')
  })
})

describe('implicitKey', () => {
  it('turns the account id back into its public key', () => {
    const key = KeyPair.fromRandom('ed25519')
    const account = keyToImplicitAddress(key.getPublicKey())
    expect(implicitKey(account).toString()).toBe(key.getPublicKey().toString())
  })

  it('refuses named accounts', () => {
    expect(() => implicitKey('alice.testnet')).toThrow('implicit')
  })
})

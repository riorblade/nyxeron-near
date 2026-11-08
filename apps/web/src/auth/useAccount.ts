// The signed-in player: Privy session, their NEAR wallet (created on first sign-in), the account made usable on chain
// (POST /api/onboard, once per session), the profile from /api/me and the dollar balance from USDC on NEAR.
import { usePrivy } from '@privy-io/react-auth'
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains'
import type { AppType } from '@nyxeron/api'
import { hc } from 'hono/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nearProvider, type Network, tokenBalance } from '../near/chain.ts'
import type { SignHash } from '../near/delegate.ts'

export type ApiConfig = { network: Network; contractId: string; usdcId: string }
export type Profile = { id: string; email: string; nearAccount: string; name: string; banned: boolean }

export function useAccount() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { createWallet } = useCreateWallet()
  const { signRawHash } = useSignRawHash()
  const [config, setConfig] = useState<ApiConfig>()
  const [profile, setProfile] = useState<Profile>()
  const [balance, setBalance] = useState<number>()
  const [setupError, setSetupError] = useState<string>()
  const creating = useRef(false)
  const onboarded = useRef<string>(undefined)

  const wallet = user?.linkedAccounts.find((a) => a.type === 'wallet' && a.chainType === 'near')
  const address = wallet?.type === 'wallet' ? wallet.address : undefined

  // Typed api client that sends the Privy token on every call once signed in (signed-out calls need none).
  const api = useMemo(
    () =>
      hc<AppType>('/', {
        headers: async (): Promise<Record<string, string>> => {
          const token = authenticated ? await getAccessToken() : null
          return token ? { authorization: `Bearer ${token}` } : {}
        },
      }).api,
    [authenticated, getAccessToken],
  )

  useEffect(() => {
    void api.config
      .$get()
      .then((r) => r.json())
      .then((c) => setConfig({ network: c.network, contractId: c.contractId, usdcId: c.usdcId }))
      .catch(() => setSetupError("Can't reach the game server."))
  }, [api])

  // First sign-in: Privy has no NEAR wallet yet, make one.
  useEffect(() => {
    if (!authenticated || !user || address || creating.current) return
    creating.current = true
    createWallet({ chainType: 'near' })
      .catch(() => setSetupError("Couldn't create your wallet. Reload to try again."))
      .finally(() => (creating.current = false))
  }, [authenticated, user, address, createWallet])

  // Once per wallet per session: make the account usable on chain, then read the profile.
  useEffect(() => {
    if (!authenticated || !address || onboarded.current === address) return
    onboarded.current = address
    void (async () => {
      const r = await api.onboard.$post()
      if (!r.ok && r.status !== 429) setSetupError('Setting up your account failed. Reload to try again.')
      const me = await api.me.$get()
      if (me.ok) setProfile(await me.json())
    })()
  }, [authenticated, address, api])

  const refreshBalance = useCallback(async () => {
    if (!config || !address) return
    try {
      setBalance(await tokenBalance(nearProvider(config.network), config.usdcId, address))
    } catch {
      // Keep the last known balance; the next refresh will try again.
    }
  }, [config, address])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  const sign: SignHash | undefined = useMemo(
    () => (address ? async (hash) => (await signRawHash({ address, chainType: 'near', hash })).signature : undefined),
    [address, signRawHash],
  )

  return {
    ready,
    authenticated,
    login,
    logout,
    api,
    config,
    address,
    profile,
    balance,
    refreshBalance,
    sign,
    setupError,
    // Signed in, wallet made, account onboarded: the player can pay.
    canPay: Boolean(authenticated && address && profile?.nearAccount && sign && config),
  }
}

export type Account = ReturnType<typeof useAccount>

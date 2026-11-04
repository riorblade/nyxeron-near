import { Hono } from 'hono'
import { type AppEnv, type Identity, requireActive, requireUser } from './auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { AppError, rateLimit } from './http.ts'
import type { Relayer } from './near.ts'

// Makes a new player's NEAR account usable at no cost to them (spike 04): the relayer creates the implicit account
// with a 0 NEAR transfer and registers it on USDC. Safe to call again: it only does what is missing.
export function onboardRoutes(deps: { cfg: Config; db: Db; identity: Identity; relayer?: Relayer }) {
  const limited = rateLimit(3, 60_000)
  return new Hono<AppEnv>().use(requireUser(deps)).post('/', requireActive, async (c) => {
    if (!deps.relayer) throw new AppError(503, 'relayer_off')
    const account = c.var.user.near_account
    if (!account) throw new AppError(409, 'no_near_account')
    limited(c.var.user.id)
    const r = deps.relayer
    const usdc = deps.cfg.USDC_CONTRACT_ID
    const created = (await r.accountExists(account)) ? undefined : await r.createImplicit(account)
    const registered = (await r.isRegistered(usdc, account)) ? undefined : await r.register(usdc, account)
    return c.json({ nearAccount: account, createdTx: created ?? null, registeredTx: registered ?? null })
  })
}

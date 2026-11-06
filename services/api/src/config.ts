import { z } from 'zod'

// Circle's USDC on NEAR (spike 04/05).
export const USDC_BY_NETWORK = {
  testnet: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
  mainnet: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
} as const

const Env = z
  .object({
    PORT: z.coerce.number().int().positive().default(8788),
    DATA_DIR: z.string().min(1).default('.data'),
    PRIVY_APP_ID: z.string().min(1),
    PRIVY_APP_SECRET: z.string().min(1),
    OWNER_EMAILS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    NEAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
    DEMO_MODE: z.stringbool().default(false),
    // The account that pays players' gas and the 1 yocto their payments need. Without it, /relay and /onboard are off.
    RELAYER_ACCOUNT_ID: z.string().min(2).optional(),
    RELAYER_KEY: z.string().startsWith('ed25519:').optional(),
    CONTRACT_ID: z.string().min(2).optional(),
    USDC_CONTRACT_ID: z.string().min(2).optional(),
    // ed25519 secret the api signs drink quotes with; its public key is set on the contract with set_quote_key.
    QUOTE_KEY: z.string().startsWith('ed25519:').optional(),
    // The contract's owner account: releases a party's wholesale, mints the warehouse's units, settles them to guests.
    // Without it the settlement job is off. May be the same account as the relayer.
    OWNER_ACCOUNT_ID: z.string().min(2).optional(),
    OWNER_KEY: z.string().startsWith('ed25519:').optional(),
    // "Get test dollars" (testnet + DEMO_MODE): micro-USDC per grant, once a day per player, sent by the relayer.
    TEST_DOLLARS: z.coerce.number().int().positive().max(20_000_000).default(3_000_000),
    // NEAR Intents 1Click (Add money / Cash out). The JWT is optional: without it 1Click adds 0.25 % to each quote.
    ONECLICK_URL: z.url().default('https://1click.chaindefuser.com'),
    ONECLICK_JWT: z.string().min(10).optional(),
  })
  .refine((e) => !(e.DEMO_MODE && e.NEAR_NETWORK === 'mainnet'), {
    message: 'DEMO_MODE hands out free credits: never on mainnet',
    path: ['DEMO_MODE'],
  })
  .refine((e) => Boolean(e.RELAYER_ACCOUNT_ID) === Boolean(e.RELAYER_KEY), {
    message: 'set RELAYER_ACCOUNT_ID and RELAYER_KEY together',
    path: ['RELAYER_KEY'],
  })
  .refine((e) => Boolean(e.OWNER_ACCOUNT_ID) === Boolean(e.OWNER_KEY), {
    message: 'set OWNER_ACCOUNT_ID and OWNER_KEY together',
    path: ['OWNER_KEY'],
  })
  .refine((e) => e.NEAR_NETWORK === 'testnet' || Boolean(e.CONTRACT_ID), {
    message: 'CONTRACT_ID is required on mainnet',
    path: ['CONTRACT_ID'],
  })
  .transform((e) => ({
    ...e,
    CONTRACT_ID: e.CONTRACT_ID ?? 'nyxeron.testnet',
    USDC_CONTRACT_ID: e.USDC_CONTRACT_ID ?? USDC_BY_NETWORK[e.NEAR_NETWORK],
  }))

export type Config = z.infer<typeof Env>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // A line left blank in .env (`KEY=`) means "not set", as .env.example ships most of them.
  const parsed = Env.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')))
  if (!parsed.success) throw new Error(`invalid environment:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

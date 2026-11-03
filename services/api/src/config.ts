import { z } from 'zod'

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
  })
  .refine((e) => !(e.DEMO_MODE && e.NEAR_NETWORK === 'mainnet'), {
    message: 'DEMO_MODE hands out free credits: never on mainnet',
    path: ['DEMO_MODE'],
  })

export type Config = z.infer<typeof Env>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env)
  if (!parsed.success) throw new Error(`invalid environment:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

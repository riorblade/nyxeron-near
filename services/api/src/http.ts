import { zValidator } from '@hono/zod-validator'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ZodType } from 'zod'

// Every refusal is `{ error: "<code>" }` with a fitting status, so clients branch on the code, never on text.
export class AppError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string

  constructor(status: ContentfulStatusCode, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

// Generic over the target so the web's typed client (hc<AppType>) only asks for the part each route validates.
export function validate<Target extends 'json' | 'query' | 'param', T extends ZodType>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      return c.json({ error: 'bad_request', issues }, 400)
    }
  })
}

// At most `limit` calls per key per window; throws 429 `too_many` beyond that.
// ponytail: in-memory, per process; fine for one api instance, move to the database if we ever run several.
export function rateLimit(limit: number, windowMs: number, now = Date.now) {
  const hits = new Map<string, number[]>()
  return (key: string) => {
    const t = now()
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs)
    if (recent.length >= limit) throw new AppError(429, 'too_many')
    recent.push(t)
    hits.set(key, recent)
  }
}

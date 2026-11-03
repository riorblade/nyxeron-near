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

export function validate<T extends ZodType>(target: 'json' | 'query' | 'param', schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      return c.json({ error: 'bad_request', issues }, 400)
    }
  })
}

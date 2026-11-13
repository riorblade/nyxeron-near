// Every page as Markdown too: /quickstart.md, or any page asked for with `Accept: text/markdown`.
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation'
import { type NextRequest, NextResponse } from 'next/server'

const { rewrite: rewriteSuffix } = rewritePath('{/*path}.md', '/llms.mdx{/*path}/content.md')
const { rewrite: rewritePage } = rewritePath('{/*path}', '/llms.mdx{/*path}/content.md')

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const suffix = rewriteSuffix(pathname)
  if (suffix) return NextResponse.rewrite(new URL(suffix, request.nextUrl))
  if (isMarkdownPreferred(request) && !/^\/(api|llms|_next)/.test(pathname)) {
    const page = rewritePage(pathname)
    if (page) return NextResponse.rewrite(new URL(page, request.nextUrl), { headers: { Vary: 'Accept' } })
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/|images/|logo/|icon.svg).*)'] }

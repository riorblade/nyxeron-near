import { createGetUrl } from 'fumadocs-core/source'

export const appName = 'NYXERON'
export const siteUrl = 'https://docs.nyxeron.xyz'
// The docs live at the root of docs.nyxeron.xyz; each page also has a plain Markdown copy for AI tools.
export const docsRoute = '/'
export const docsContentRoute = '/llms.mdx'

const getContentUrl = createGetUrl(docsContentRoute)

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md']
  return { segments, url: getContentUrl(segments, page.locale) }
}

# apps/docs

**Owner:** Wisnu (@AdityaWisnuu). Issue #127.

The docs at **docs.nyxeron.xyz**: Next.js with [Fumadocs](https://fumadocs.dev), pages in MDX under
`content/docs` (order in `content/docs/meta.json`). Written for judges, players and AI tools alike:

| Route                         | What                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| `/`, `/quickstart`, …         | The pages, prerendered                                                  |
| `/llms.txt`                   | Index of every page, for AI tools                                       |
| `/llms-full.txt`              | Every page in one Markdown file                                         |
| `/<page>.md`                  | One page as Markdown (also any page asked with `Accept: text/markdown`) |
| `/api/search`                 | Search (the box in the sidebar)                                         |
| `/sitemap.xml`, `/robots.txt` | For crawlers                                                            |

No secrets, no private host names and no links to the source code in the pages (#127).

```sh
pnpm --filter @nyxeron/docs dev     # http://localhost:3100
pnpm --filter @nyxeron/docs build
```

## Deploy (Vercel)

A second Vercel project from this repo: **Root Directory** `apps/docs`, framework Next.js (detected), no env vars.
Add the domain `docs.nyxeron.xyz` to it and point the `docs` record in DNS to what Vercel shows (a CNAME to
Vercel's DNS). Remove `docs.nyxeron.xyz` from the old Mintlify project first.

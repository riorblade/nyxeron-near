// After `vite build`: renders the landing to HTML once and writes dist/landing.html, which vercel.json serves at the
// root of nyxeron.xyz. Crawlers, link previews and AI screeners then read the landing's text without running JS;
// main.tsx hydrates it in the browser. The app shell moves to dist/app.html: Vercel serves an existing file before it
// applies rewrites, so a dist/index.html would always answer `/` and the landing host would never get landing.html.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const vite = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
})
try {
  const { Landing } = await vite.ssrLoadModule('/src/landing/Landing.tsx')
  const body = renderToString(createElement(Landing))
  const html = readFileSync(`${root}dist/index.html`, 'utf8')
  const page = html
    .replace('<title>NYXERON</title>', '<title>NYXERON · a nightclub where every drink is a real share</title>')
    .replace('</head>', '    <link rel="canonical" href="https://nyxeron.xyz/" />\n  </head>')
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`)
  if (page === html || !page.includes('<h1')) throw new Error('prerender: the landing did not render into index.html')
  writeFileSync(`${root}dist/landing.html`, page)
  renameSync(`${root}dist/index.html`, `${root}dist/app.html`)
  console.log(`prerender: dist/landing.html (${(page.length / 1024).toFixed(1)} KB), app shell at dist/app.html`)
} finally {
  await vite.close()
}

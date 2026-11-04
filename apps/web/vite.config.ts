import { appendFileSync, mkdirSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Spike 10: the test page posts its log lines here so phone runs land in a file instead of screenshots. Dev only.
const spikeLog: Plugin = {
  name: 'spike-log',
  configureServer(server) {
    server.middlewares.use('/__spike-log', (req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString().slice(0, 4000)))
      req.on('end', () => {
        mkdirSync('.data', { recursive: true })
        appendFileSync('.data/spike10.log', `${body}\n`)
        res.end()
      })
    })
  },
}

export default defineConfig({
  // near-api-js pulls in Node's util, process and Buffer; the browser needs them polyfilled (as near-examples/hello-privy).
  plugins: [nodePolyfills(), react(), tailwindcss(), spikeLog],
  // allowedHosts: phone tests go through a temporary https tunnel (cloudflared), which Privy and crypto.subtle need.
  server: { proxy: { '/api': 'http://localhost:8788' }, allowedHosts: ['.trycloudflare.com'] },
})

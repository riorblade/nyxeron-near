import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  // near-api-js pulls in Node's util, process and Buffer; the browser needs them polyfilled (as near-examples/hello-privy).
  plugins: [nodePolyfills(), react()],
  server: { proxy: { '/api': 'http://localhost:8788' } },
})

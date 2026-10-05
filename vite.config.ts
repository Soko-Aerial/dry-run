import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ponytail: dev proxy to the Python bridge until MAVLink moves into Electron's main process.
// The bridge rejects requests with an Origin header or a foreign Host.
const bridge = (path: string) => ({
  target: 'http://127.0.0.1:8765',
  changeOrigin: true,
  rewrite: () => path,
  configure: (proxy: { on: (e: 'proxyReq', f: (req: { removeHeader(h: string): void }) => void) => void }) =>
    proxy.on('proxyReq', (req) => req.removeHeader('origin')),
})

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  server: {
    proxy: {
      '/api/mavlink/mission': bridge('/mission'),
      '/api/mavlink': bridge('/telemetry'),
    },
  },
})

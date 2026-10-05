// node scripts/electron.mjs [build|dev|start]
// build: bundle electron/ with the Mapbox token baked in. dev: build, then run against the Vite dev server.
// start: run the built app. Main-process changes need a restart; the renderer hot-reloads.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { build } from 'esbuild'
import { createServer, loadEnv } from 'vite'
import electron from 'electron'

const mode = process.argv[2] ?? 'build'
const { MAPBOX_TOKEN = '' } = loadEnv(mode === 'build' ? 'production' : 'development', process.cwd(), 'MAPBOX_')

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  define: { 'process.env.MAPBOX_TOKEN': JSON.stringify(MAPBOX_TOKEN) },
  logLevel: 'warning',
})
if (!MAPBOX_TOKEN) console.warn('MAPBOX_TOKEN not set: the map is disabled and terrain is synthetic.')

if (mode !== 'build') {
  const server = mode === 'dev' ? await createServer() : null
  await server?.listen()
  // Chromium refuses to run as root (WSL default) without this.
  const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])]
  const env = { ...process.env, ...(server && { DRY_RUN_DEV_URL: server.resolvedUrls.local[0] }) }
  // WSL: Mesa defaults to llvmpipe (CPU, ~2 fps playback). Its d3d12 driver reaches the real GPU.
  if (existsSync('/dev/dxg')) env.GALLIUM_DRIVER ??= 'd3d12'
  spawn(electron, args, { stdio: 'inherit', env }).on('exit', async (code) => {
    await server?.close()
    process.exit(code ?? 0)
  })
}

# Desktop app plan

Dry run becomes an installed Electron app for Linux and Windows. No web deploy.

## Decisions

1. Installed app, Mapbox online. Terrain tiles cached on disk so revisited areas work offline. Full offline region download only when the field needs it.
2. Electron, not Tauri: WebKitGTK's WebGL is too weak on Linux for Mapbox + three.js.
3. Vite + React SPA. Next.js, vinext, wrangler and the Cloudflare deploy are removed.
4. MAVLink bridge ported to TypeScript in the main process (UDP via `dgram`). Python and uv removed. Add `serialport` when someone needs a direct USB radio.
5. Mapbox `pk.` token baked in at build time (`MAPBOX_TOKEN`), with an override in settings.
6. Manual `.exe` (NSIS) and `.AppImage` from `pnpm dist` during the pilot. Add auto-update when copying files gets annoying.
7. Budgets: window < 1 s, map < 2 s on a warm cache, 60 fps playback, check < 100 ms for a typical mission. Measure, then fix only what misses.
8. Open-only, plus `.plan`/`.waypoints` file association. Save/Save As is a follow-up.

## Steps

1. Next → Vite. The app runs in a browser without a server.
2. Electron shell: window, preload, `tiles://` protocol with a disk cache, token.
3. MAVLink port to TypeScript, with the `test_bridge.py` cases ported. Verify against SITL.
4. Packaging: electron-builder, `.exe` + `.AppImage`, file association.
5. Measure against the budgets.

## Measured (2026-10-05, WSL2 dev laptop, Quadro M2000M via WSL's d3d12 layer)

| Budget | Result | |
|---|---|---|
| Window < 1 s | 0.85–1.0 s launch to usable UI; 1.0 s launch to a mission opened from the command line | met |
| Map < 2 s on a warm cache | map canvas up ~1.2 s after the window on a GPU; check done 1.2 s after launch | met |
| Check < 100 ms | edits re-check in 0.3–10 ms; first check on a mission 54–120 ms, almost all PNG decode of 4 terrain tiles | edits met; first open ≤ 20 ms over |
| 60 fps playback | idle 54 fps; playback 12–20 fps | missed on this machine |

Playback profile: Mapbox's own JS ~33% of the time, our React/app code ~8%, the rest waiting on the GPU. No long tasks. Turning off MSAA changed nothing. The limit is this 2015 GPU behind WSL's D3D12 translation, not app code. Re-measure on a field PC before optimising; the levers if it's slow there are Mapbox `pixelRatio`, and the classic `satellite-v9` style instead of Standard Satellite (no 3D lighting/landmarks).

Packaged: AppImage 118 MB, `app.asar` 5 MB.

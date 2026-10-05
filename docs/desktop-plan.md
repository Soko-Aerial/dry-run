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

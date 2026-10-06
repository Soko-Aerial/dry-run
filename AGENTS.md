# dry run

An Electron desktop app for Linux and Windows. There is no Next.js and no server.

- Renderer: Vite + React in `app/`, `components/`, `lib/`. It has no Node access.
- Main process: `electron/`. It serves the app (`app://`), terrain tiles with a disk cache (`tiles://`), and MAVLink over UDP (`electron/mavlink.ts`).
- The renderer reaches the main process only through `window.dryRun`, exposed in `electron/preload.ts` and typed in `electron/window.d.ts`.
- `pnpm dev` runs the app with hot reload, `pnpm test` runs the checks, `pnpm lint` lints, and `pnpm dist` builds the installer for the current OS.
- Design notes: `DESIGN.md`. The desktop plan and performance measurements: `docs/desktop-plan.md`.

import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openLink, type Link } from './mavlink'

const DIST = join(__dirname, '..', 'dist')
const TILE = /^\/(\d+)\/(\d+)\/(\d+)$/

// The map is useless without WebGL. Chromium blocklists many Linux drivers (WSLg's included) and
// no longer falls back to software WebGL on its own. We only load our own code and Mapbox, so the
// "unsafe" in swiftshader (untrusted content reaching a CPU renderer) doesn't apply.
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

// One window: opening a mission from the OS while running hands it to the existing instance.
if (!app.requestSingleInstanceLock()) app.exit()

/** The mission file in a command line (file association, "Open with"), read for the renderer. */
async function missionFile(argv: string[]) {
  const path = argv.find((arg) => !arg.startsWith('-') && /\.(plan|waypoints|txt|json)$/i.test(arg))
  if (!path) return null
  try {
    // Missions are a few KB; refuse anything that clearly isn't one.
    if ((await stat(path)).size > 10_000_000) return null
    return { name: basename(path), text: await readFile(path, 'utf8') }
  } catch {
    return null
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'tiles', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

// settings.json in userData overrides the token baked in at build time.
async function loadToken() {
  try {
    const settings = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8'))
    if (typeof settings.mapboxToken === 'string' && settings.mapboxToken) return settings.mapboxToken
  } catch { /* no settings yet */ }
  return process.env.MAPBOX_TOKEN ?? ''
}

app.whenReady().then(async () => {
  const token = await loadToken()
  const tileDir = join(app.getPath('userData'), 'tiles')
  ipcMain.on('mapbox-token', (e) => { e.returnValue = token })

  protocol.handle('app', (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname)
    const file = join(DIST, path === '/' ? 'index.html' : path)
    if (!file.startsWith(DIST + sep)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // tiles://terrain/z/x/y — Mapbox terrain-DEM @2x, cached on disk forever (terrain doesn't change).
  // 404 without a token is the renderer's cue to fall back to synthetic terrain.
  // ponytail: cache never evicts; tiles are ~100–200 KB, add a size cap if a disk ever fills.
  protocol.handle('tiles', async (req) => {
    const headers = { 'content-type': 'image/png', 'access-control-allow-origin': '*' }
    const m = new URL(req.url).pathname.match(TILE)
    if (!m) return new Response('bad tile', { status: 400, headers })
    const [, z, x, y] = m
    const file = join(tileDir, z, x, `${y}.png`)
    try {
      return new Response(await readFile(file), { headers })
    } catch { /* not cached */ }
    if (!token) return new Response('no Mapbox token', { status: 404, headers })
    const res = await net.fetch(
      `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${z}/${x}/${y}@2x.pngraw?access_token=${token}`)
    if (!res.ok) return new Response('tile unavailable', { status: res.status, headers })
    const body = Buffer.from(await res.arrayBuffer())
    // Write then rename: a crash mid-write must not leave a corrupt tile that's served forever.
    await mkdir(dirname(file), { recursive: true })
    await writeFile(`${file}.${process.pid}.tmp`, body)
    await rename(`${file}.${process.pid}.tmp`, file)
    return new Response(body, { headers })
  })

  // One MAVLink link for the app, opened on Connect and closed on Disconnect so port 14550
  // is free for other tools. Calls are serialized: a Disconnect during a pending bind must win.
  let link: Link | null = null
  let telemetry: ReturnType<typeof setInterval> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(f: () => Promise<T>) => (queue = queue.then(f, f)) as Promise<T>
  const disconnect = async () => {
    clearInterval(telemetry)
    link?.close()
    link = null
  }
  ipcMain.handle('mavlink:connect', (e) => serial(async () => {
    try {
      link ??= await openLink()
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? 'UDP port 14550 is in use. Close other software listening on it and reconnect.'
        : `MAVLink connection failed: ${(error as Error).message}`
    }
    const { bridge } = link
    const push = () => { if (!e.sender.isDestroyed()) e.sender.send('mavlink:telemetry', bridge.snapshot()) }
    clearInterval(telemetry)
    telemetry = setInterval(push, 500)
    push()
    return null
  }))
  ipcMain.handle('mavlink:disconnect', () => serial(disconnect))
  ipcMain.handle('mavlink:mission', async () => {
    if (!link) return { error: 'Connect MAVLink first.' }
    try {
      return { mission: await link.bridge.download() }
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  // VS Code-style title bar: the app header is the title bar, the OS draws only the window
  // buttons over its right end (h-9 = 36 px). Colours follow the app theme, not the OS.
  const titleBar = (dark: boolean) => ({
    height: 36, color: dark ? '#0a0a0a' : '#ffffff', symbolColor: dark ? '#fafafa' : '#0a0a0a',
  })
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBar(nativeTheme.shouldUseDarkColors),
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs') },
  })
  win.once('ready-to-show', () => win.show())
  // The app's theme toggle drives the native theme too: Windows recolours the window buttons
  // from it, and setTitleBarOverlay alone doesn't repaint them there. 'system' keeps following the OS.
  ipcMain.on('theme', (_e, theme: 'system' | 'light' | 'dark') => {
    if (!['system', 'light', 'dark'].includes(theme)) return
    nativeTheme.themeSource = theme
    const dark = nativeTheme.shouldUseDarkColors
    win.setBackgroundColor(titleBar(dark).color)
    win.setTitleBarOverlay(titleBar(dark))
  })
  nativeTheme.on('updated', () => win.setTitleBarOverlay(titleBar(nativeTheme.shouldUseDarkColors)))
  // Handed over once, so a renderer reload (or React StrictMode's double effect) doesn't reopen it.
  let launchFile: ReturnType<typeof missionFile> | null = missionFile(process.argv.slice(1))
  ipcMain.handle('open-file:launch', () => {
    const file = launchFile
    launchFile = null
    return file
  })
  app.on('second-instance', async (_e, argv) => {
    if (win.isMinimized()) win.restore()
    win.focus()
    const file = await missionFile(argv.slice(1))
    if (file) win.webContents.send('open-file', file)
  })
  // External links (Mapbox attribution) go to the system browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.loadURL(process.env.DRY_RUN_DEV_URL ?? 'app://dry-run/')
})

app.on('window-all-closed', () => app.quit())

import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIST = join(__dirname, '..', 'dist')
const TILE = /^\/(\d+)\/(\d+)\/(\d+)$/

// The map is useless without WebGL. Chromium blocklists many Linux drivers (WSLg's included) and
// no longer falls back to software WebGL on its own. We only load our own code and Mapbox, so the
// "unsafe" in swiftshader (untrusted content reaching a CPU renderer) doesn't apply.
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

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

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs') },
  })
  win.once('ready-to-show', () => win.show())
  // External links (Mapbox attribution) go to the system browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.loadURL(process.env.DRY_RUN_DEV_URL ?? 'app://dry-run/')
})

app.on('window-all-closed', () => app.quit())

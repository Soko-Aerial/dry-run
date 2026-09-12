import { decodePng } from './png'

/**
 * Terrain heights from Mapbox terrain-RGB tiles.
 *
 * One grid covering the mission bbox, sampled two different ways on purpose
 * (DESIGN.md #10): the mesh downsamples for framerate, the clearance check
 * reads full resolution. Visual fidelity and safety fidelity must not compete.
 *
 * LIMIT: ~10m ground sampling at z14, and terrain-RGB is bare-earth-ish. This
 * sees hills. It does not see masts, cranes, power lines or treelines.
 */

export type Bbox = { minLat: number; minLon: number; maxLat: number; maxLon: number }

export type Grid = {
  z: number
  tileSize: number
  /** global pixel coords of grid[0][0] at this zoom */
  px0: number
  py0: number
  width: number
  height: number
  data: Float32Array
  synthetic: boolean
  /** decoded heights are implausible for land — treat the verdict as void */
  suspect: string | null
}

const lonToPx = (lon: number, z: number, ts: number) => ((lon + 180) / 360) * Math.pow(2, z) * ts

const latToPx = (lat: number, z: number, ts: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z) * ts
}

/** terrain-RGB decode. The one line the whole layer rests on. */
const decode = (r: number, g: number, b: number) => -10000 + (r * 65536 + g * 256 + b) * 0.1

/**
 * ponytail: smooth deterministic hills, for developing before the token lands.
 * Not a terrain model — just something with slopes to fly into.
 */
const syntheticHeight = (lat: number, lon: number) =>
  120 +
  180 * Math.sin(lat * 900) * Math.cos(lon * 900) +
  60 * Math.sin(lat * 2600 + 1.3) +
  40 * Math.cos(lon * 3100)

// ponytail: unbounded Map of decoded tiles. A survey covers a handful of them
// and editing a waypoint re-runs the whole pipeline per keystroke; evict only if
// someone opens enough missions in one session to feel it.
const tileCache = new Map<string, Promise<Awaited<ReturnType<typeof decodePng>> | null>>()

function fetchTile(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`
  const hit = tileCache.get(key)
  if (hit) return hit
  const t = fetch(`/api/tiles/${key}`).then(async (res) =>
    res.ok ? decodePng(await res.arrayBuffer()) : null,
  )
  tileCache.set(key, t)
  return t
}

export async function loadGrid(bbox: Bbox, z = 14, marginTiles = 0): Promise<Grid> {
  const ts = 512 // @2x tiles
  const tx0 = Math.floor(lonToPx(bbox.minLon, z, ts) / ts) - marginTiles
  const tx1 = Math.floor(lonToPx(bbox.maxLon, z, ts) / ts) + marginTiles
  const ty0 = Math.floor(latToPx(bbox.maxLat, z, ts) / ts) - marginTiles
  const ty1 = Math.floor(latToPx(bbox.minLat, z, ts) / ts) + marginTiles

  const cols = tx1 - tx0 + 1
  const rows = ty1 - ty0 + 1
  const width = cols * ts
  const height = rows * ts
  const data = new Float32Array(width * height)

  const tiles = await Promise.all(
    Array.from({ length: cols * rows }, (_, i) =>
      fetchTile(z, tx0 + (i % cols), ty0 + Math.floor(i / cols)),
    ),
  )

  const synthetic = tiles.some((t) => t === null)
  const grid: Grid = {
    z, tileSize: ts, px0: tx0 * ts, py0: ty0 * ts, width, height, data, synthetic,
    suspect: null,
  }

  if (synthetic) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const { lat, lon } = pxToLatLon(grid.px0 + x, grid.py0 + y, z, ts)
        data[y * width + x] = syntheticHeight(lat, lon)
      }
    }
    return grid
  }

  const tilesData = tiles
  tilesData.forEach((png, i) => {
    if (!png) return
    const ox = (i % cols) * ts
    const oy = Math.floor(i / cols) * ts
    const ch = png.channels
    for (let y = 0; y < ts; y++) {
      for (let x = 0; x < ts; x++) {
        const s = (y * png.width + x) * ch
        data[(oy + y) * width + ox + x] = decode(png.data[s], png.data[s + 1], png.data[s + 2])
      }
    }
  })

  // A wrong decode produces a confident verdict on nonsense. Lowest dry land
  // on earth is about -430m; nothing we survey is above 9000m.
  const { min, max } = gridStats(grid)
  if (min < -500 || max > 9000) {
    grid.suspect = `Decoded elevations span ${min.toFixed(0)}m to ${max.toFixed(0)}m — implausible for land. Terrain decode is wrong; ignore this verdict.`
  }
  return grid
}

function pxToLatLon(px: number, py: number, z: number, ts: number) {
  const scale = Math.pow(2, z) * ts
  const lon = (px / scale) * 360 - 180
  const nRad = Math.PI - 2 * Math.PI * (py / scale)
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(nRad) - Math.exp(-nRad)))
  return { lat, lon }
}

/** Bilinear sample in AMSL metres. Out of grid returns the nearest edge. */
export function sampleAt(grid: Grid, lat: number, lon: number): number {
  const gx = lonToPx(lon, grid.z, grid.tileSize) - grid.px0
  const gy = latToPx(lat, grid.z, grid.tileSize) - grid.py0
  const x0 = Math.max(0, Math.min(grid.width - 2, Math.floor(gx)))
  const y0 = Math.max(0, Math.min(grid.height - 2, Math.floor(gy)))
  const fx = Math.max(0, Math.min(1, gx - x0))
  const fy = Math.max(0, Math.min(1, gy - y0))
  const i = (x: number, y: number) => grid.data[y * grid.width + x]
  const top = i(x0, y0) * (1 - fx) + i(x0 + 1, y0) * fx
  const bot = i(x0, y0 + 1) * (1 - fx) + i(x0 + 1, y0 + 1) * fx
  return top * (1 - fy) + bot * fy
}

export function gridStats(grid: Grid) {
  let min = Infinity
  let max = -Infinity
  for (const v of grid.data) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max }
}

/**
 * Mission bounding box plus ~550m. The pad is deliberate, not incidental: it
 * defines the area "highest terrain" is reported over, so shrinking it to save
 * tiles quietly changes an answer the pilot relies on.
 */
export function bboxOf(pts: { lat: number; lon: number }[], padDeg = 0.005): Bbox {
  const lats = pts.map((p) => p.lat)
  const lons = pts.map((p) => p.lon)
  return {
    minLat: Math.min(...lats) - padDeg,
    maxLat: Math.max(...lats) + padDeg,
    minLon: Math.min(...lons) - padDeg,
    maxLon: Math.max(...lons) + padDeg,
  }
}

/**
 * Terrain mesh, downsampled to a vertex budget. Deliberately coarser than the
 * clearance check — see DESIGN.md #10. If mesh and verdict disagree, the
 * verdict is right.
 */
export function gridToMesh(
  grid: Grid,
  origin: { lat: number; lon: number },
  maxVerts = 90_000,
) {
  const step = Math.max(1, Math.ceil(Math.sqrt((grid.width * grid.height) / maxVerts)))
  const cols = Math.floor(grid.width / step)
  const rows = Math.floor(grid.height / step)
  const fLat = 110574
  const fLon = 111320 * Math.cos((origin.lat * Math.PI) / 180)

  const positions = new Float32Array(cols * rows * 3)
  const colors = new Float32Array(cols * rows * 3)
  const { min, max } = gridStats(grid)
  const span = Math.max(1, max - min)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gx = c * step
      const gy = r * step
      const { lat, lon } = pxToLatLon(grid.px0 + gx, grid.py0 + gy, grid.z, grid.tileSize)
      const h = grid.data[gy * grid.width + gx]
      const i = (r * cols + c) * 3
      // three.js is Y-up: x=east, y=alt, z=-north
      positions[i] = (lon - origin.lon) * fLon
      positions[i + 1] = h
      positions[i + 2] = -(lat - origin.lat) * fLat

      // green valley -> brown slope -> grey rock. Keep it dark: the shading
      // carries the relief, the colour only has to say "how high".
      const t = Math.max(0, Math.min(1, (h - min) / span))
      colors[i] = 0.16 + t * 0.42
      colors[i + 1] = 0.26 + t * 0.28
      colors[i + 2] = 0.12 + t * 0.36
    }
  }

  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6)
  let k = 0
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      indices[k++] = a
      indices[k++] = a + cols
      indices[k++] = a + 1
      indices[k++] = a + 1
      indices[k++] = a + cols
      indices[k++] = a + cols + 1
    }
  }
  return { positions, colors, indices, cols, rows, step }
}

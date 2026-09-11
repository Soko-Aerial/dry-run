/**
 * Minimal PNG decoder for terrain-RGB tiles.
 *
 * Why not canvas: terrain-RGB pixels are packed 24-bit integers, not colour.
 * createImageBitmap + drawImage + getImageData is a rendering path — it is
 * entitled to colour-manage and round, and on some machines it does, losing
 * one count in the red channel. Red is the x65536 byte, so that single count
 * is a 6553.6m elevation error and a silently wrong verdict.
 *
 * ponytail: 8-bit non-interlaced RGB/RGBA only — which is all Mapbox serves.
 * Inflate is DecompressionStream, so no dependency.
 */

export type Png = { width: number; height: number; channels: number; data: Uint8Array }

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]

export async function decodePng(buf: ArrayBuffer): Promise<Png> {
  const bytes = new Uint8Array(buf)
  if (!PNG_SIG.every((b, i) => bytes[i] === b)) throw new Error('not a PNG')
  const view = new DataView(buf)

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Uint8Array[] = []

  let p = 8
  while (p < bytes.length) {
    const len = view.getUint32(p)
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    const body = p + 8
    if (type === 'IHDR') {
      width = view.getUint32(body)
      height = view.getUint32(body + 4)
      bitDepth = bytes[body + 8]
      colorType = bytes[body + 9]
      interlace = bytes[body + 12]
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(body, body + len))
    } else if (type === 'IEND') {
      break
    }
    p = body + len + 4 // skip CRC
  }

  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: depth ${bitDepth} colour ${colorType} interlace ${interlace}`)
  }
  const channels = colorType === 6 ? 4 : 3

  // IDAT payload is zlib-wrapped, which is what 'deflate' means on the web.
  const blob = new Blob(idat as BlobPart[])
  const inflated = new Uint8Array(
    await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(),
  )

  const stride = width * channels
  const out = new Uint8Array(stride * height)
  let src = 0
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]
    const row = y * stride
    const prev = row - stride
    for (let i = 0; i < stride; i++) {
      const raw = inflated[src++]
      const a = i >= channels ? out[row + i - channels] : 0
      const b = y > 0 ? out[prev + i] : 0
      const c = y > 0 && i >= channels ? out[prev + i - channels] : 0
      let v: number
      switch (filter) {
        case 0: v = raw; break
        case 1: v = raw + a; break
        case 2: v = raw + b; break
        case 3: v = raw + ((a + b) >> 1); break
        case 4: {
          const pa = Math.abs(b - c)
          const pb = Math.abs(a - c)
          const pc = Math.abs(a + b - 2 * c)
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`bad PNG filter ${filter}`)
      }
      out[row + i] = v & 0xff
    }
  }
  return { width, height, channels, data: out }
}

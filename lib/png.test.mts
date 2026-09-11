// ponytail: decodes a real Mapbox terrain-RGB tile and checks exact bytes.
// The bug this exists for lost ONE count in the red channel — a 6553.6m
// elevation error that still rendered as plausible-looking terrain.
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { decodePng } from './png'

const buf = readFileSync('samples/tile-14-8640-5775.png')
const png = await decodePng(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

assert.equal(png.width, 512)
assert.equal(png.height, 512)
assert.equal(png.channels, 4)

const at = (x: number, y: number) => {
  const i = (y * png.width + x) * png.channels
  return [png.data[i], png.data[i + 1], png.data[i + 2]]
}
const h = ([r, g, b]: number[]) => -10000 + (r * 65536 + g * 256 + b) * 0.1

// verified independently against the tile served by Mapbox
assert.deepEqual(at(0, 0), [1, 197, 103], `corner pixel ${at(0, 0)}`)
assert.deepEqual(at(256, 256), [1, 201, 137], `centre pixel ${at(256, 256)}`)
assert.deepEqual(at(511, 511), [1, 212, 66], `far corner ${at(511, 511)}`)
assert.ok(Math.abs(h(at(0, 0)) - 1607.1) < 0.1)

let min = Infinity
let max = -Infinity
for (let y = 0; y < 512; y += 4) {
  for (let x = 0; x < 512; x += 4) {
    const v = h(at(x, y))
    if (v < min) min = v
    if (v > max) max = v
  }
}
// Davos: valley floor to ridge. Anything outside this means the decode drifted.
assert.ok(min > 1500 && min < 1600, `min ${min}`)
assert.ok(max > 2000 && max < 2100, `max ${max}`)

console.log(`ok — png decode exact (${min.toFixed(0)}m..${max.toFixed(0)}m)`)

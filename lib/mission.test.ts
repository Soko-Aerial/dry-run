// ponytail: parses the sample corpus in samples/. Catches format drift, which
// is the failure mode that produces a confident verdict on no waypoints.
import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { parseMission, toAmsl } from './mission'

const files = readdirSync('samples').filter((f) => /\.(waypoints|txt|plan)$/.test(f))
assert.ok(files.length >= 6, 'sample corpus missing')

for (const f of files) {
  const m = parseMission(readFileSync(`samples/${f}`, 'utf8'))
  assert.ok(m.waypoints.length >= 2, `${f}: parsed ${m.waypoints.length} waypoints`)
  assert.ok(m.home, `${f}: no home position`)
  for (const w of m.waypoints) {
    assert.ok(Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180, `${f}: bad coord`)
    assert.ok(Number.isFinite(w.alt), `${f}: bad alt`)
  }
}

// Relative altitudes resolve against terrain-derived launch elevation, not zero.
{
  const m = parseMission(readFileSync('samples/davosdorf.plan', 'utf8'))
  const launchAmsl = 1562 // Davos valley floor
  const r = toAmsl(m.waypoints, launchAmsl, () => 0)
  assert.ok(
    r.every((w) => w.frame === 'relative' && w.alt === launchAmsl + w.planned),
    'relative altitudes must resolve to launch + planned',
  )
  assert.ok(r[0].alt > 1600, `Swiss mission resolved to ${r[0].alt}m AMSL — too low, frame lost`)
}

console.log(`ok — ${files.length} sample missions parsed`)

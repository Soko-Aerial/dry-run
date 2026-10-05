import { strict as assert } from 'node:assert'
import { missionFromMavlink, missionLaunchAmsl, type DownloadedMission } from './mavlink'
import { toAmsl } from './mission'

const home = { lat: -35.363261, lon: 149.16523, alt: 584 }
const item = (seq: number, frame: number, z: number, command = 16) => ({
  seq, frame, command, x: Math.round(home.lat * 1e7), y: Math.round(home.lon * 1e7), z,
  params: [0, 0, 0, null],
})
const download: DownloadedMission = {
  autopilot: 3, home,
  items: [item(0, 0, home.alt), item(1, 6, 100), item(2, 5, 710), item(3, 11, 60)],
}
const mission = missionFromMavlink(download)
assert.equal(mission.source, 'mavlink')
assert.equal(mission.waypoints.length, 3, 'ArduPilot home must not become a flown waypoint')
assert.deepEqual(mission.waypoints.map((wp) => wp.frame), ['relative', 'amsl', 'terrain'])
const launch = missionLaunchAmsl(mission, 560)
assert.equal(launch, 584, 'live relative altitudes use autopilot home, not the DEM')
assert.deepEqual(toAmsl(mission.waypoints, launch, () => 560).map((wp) => wp.alt), [684, 710, 620])
assert.equal(missionLaunchAmsl({ ...mission, source: 'plan' }, 560), 560, 'file imports retain terrain datum')
assert.deepEqual(missionFromMavlink({ ...download, home: null }).home, home, 'item zero is a fallback home')
assert.equal(missionFromMavlink({ ...download, items: [] }).waypoints.length, 0)
assert.throws(() => missionFromMavlink({ ...download, autopilot: 12 }), /ArduPilot/)
assert.throws(() => missionFromMavlink({ ...download, home: null, items: [item(1, 6, 100)] }), /home is unavailable/)
assert.throws(() => missionFromMavlink({ ...download, items: [item(0, 0, 584), item(1, 1, 100)] }), /unsupported coordinate frame/)
assert.throws(() => missionFromMavlink({ ...download, items: [item(1, 2, 100)] }), /unsupported coordinate frame/)
assert.throws(() => missionFromMavlink({ ...download, home: { ...home, alt: NaN } }), /invalid/)
assert.throws(() => missionFromMavlink({ ...download, items: [{ ...item(1, 6, 100), x: 910000000 }] }), /valid range/)
console.log('ok — MAVLink mission frames, home datum, and invalid inputs')

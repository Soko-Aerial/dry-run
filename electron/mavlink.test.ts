import { strict as assert } from 'node:assert'
import { createSocket } from 'node:dgram'
import { PassThrough } from 'node:stream'
import {
  common, minimal, MavLinkPacketParser, MavLinkPacketSplitter, MavLinkProtocolV2, type MavLinkData,
} from 'node-mavlink'
import { Bridge, decode, message, openLink, STALE_MS, type Msg } from './mavlink'

const msg = (name: string, fields: object, sysid = 1, compid = 1): Msg => ({ name, sysid, compid, ...fields })
const heartbeat = (sysid = 1, autopilot = 3) =>
  msg('HEARTBEAT', { autopilot, type: 2, baseMode: 1 | 128, customMode: 4 }, sysid)
const position = msg('GLOBAL_POSITION_INT',
  { lat: -353632610, lon: 1491652300, alt: 584000, relativeAlt: 100000, hdg: 65535, vx: 300, vy: 400 })

// Foreign heartbeats, staleness, and reconnection.
{
  let now = 1000
  const b = new Bridge(() => {}, () => now)
  b.update(heartbeat(1, 8)) // MAV_AUTOPILOT_INVALID: a GCS, not a vehicle
  assert.equal(b.target, null)
  b.update(heartbeat())
  b.update(position)
  let state = b.snapshot()
  assert.ok(state.connected)
  assert.equal(state.vehicle?.mode, 'GUIDED')
  assert.equal(state.vehicle?.armed, true)
  assert.equal(state.position?.altAmsl, 584)
  assert.equal(state.position?.groundSpeed, 5)
  assert.equal(state.position?.heading, null)
  b.update(heartbeat(2))
  assert.deepEqual(b.target, [1, 1], 'a second vehicle does not steal the target')
  now += STALE_MS + 1
  b.update(msg('ATTITUDE', { roll: 0, pitch: 0, yaw: -Math.PI / 2 }))
  state = b.snapshot()
  assert.equal(state.connected, false)
  assert.equal(state.position, null)
  b.update(heartbeat())
  state = b.snapshot()
  assert.equal(state.position, null, 'reconnection clears cached values')
  assert.equal(state.attitude, null, 'values from a stale link are cleared on reconnect')
  b.update(msg('ATTITUDE', { roll: 0, pitch: 0, yaw: -Math.PI / 2 }))
  assert.equal(b.snapshot().attitude?.yaw, 270)
}

// Downloads need a live ArduPilot heartbeat; a rejection fails fast.
{
  const b = new Bridge(() => {})
  await assert.rejects(b.download(), /heartbeat/)
  b.update(heartbeat(1, 12))
  await assert.rejects(b.download(), /ArduPilot/)
  const r = new Bridge(() => {})
  r.update(heartbeat())
  const rejected = r.exchange(() => {}, () => false, performance.now() + 5000)
  r.handle(msg('MISSION_ACK', { type: 14, missionType: 0 }))
  await assert.rejects(rejected, /rejected/)
}

// End to end over UDP against a fake ArduPilot that drops the first request
// and has a second vehicle replying out of turn.
{
  const port = 14599
  const link = await openLink(port)
  const vehicle = createSocket('udp4')
  const ap = new MavLinkProtocolV2(1, 1)
  const other = new MavLinkProtocolV2(2, 1)
  let seq = 0
  const send = (data: MavLinkData, protocol = ap) =>
    vehicle.send(protocol.serialize(data, seq++ & 255), port, '127.0.0.1')
  const received: string[] = []
  let dropped = false
  let requested = 0
  const input = new PassThrough()
  input.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser()).on('data', (packet) => {
    const m = decode(packet)!
    received.push(m.name)
    if (m.name === 'COMMAND_LONG') requested = m._param1
    if (m.name === 'MISSION_REQUEST_LIST') {
      if (!dropped) return void (dropped = true)
      send(message(common.MissionCount, { count: 99 }), other)
      send(message(common.MissionCount, { count: 2, targetSystem: 255, targetComponent: 190 }))
    }
    if (m.name === 'MISSION_REQUEST_INT') {
      send(message(common.MissionItemInt, {
        seq: m.seq, frame: 6, command: 16, x: -353632610, y: 1491652300, z: 100 + m.seq, param4: NaN,
        targetSystem: 255, targetComponent: 190,
      }))
    }
  })
  vehicle.on('message', (b) => input.write(b))
  await new Promise<void>((resolve) => vehicle.bind(0, '127.0.0.1', resolve))
  send(message(minimal.Heartbeat, { type: 2, autopilot: 3, baseMode: 1, customMode: 6 }))
  send(message(common.HomePosition, { latitude: -353632610, longitude: 1491652300, altitude: 584000 }))
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(link.bridge.snapshot().vehicle?.mode, 'RTL')
  const mission = await link.bridge.download()
  assert.deepEqual(mission.items.map((i) => [i.seq, i.z, i.params[3]]), [[0, 100, null], [1, 101, null]])
  assert.deepEqual(mission.home, { lat: -35.363261, lon: 149.16523, alt: 584 })
  await new Promise((r) => setTimeout(r, 100)) // let the final ACK datagram land
  assert.equal(received.filter((n) => n === 'MISSION_REQUEST_LIST').length, 2, 'a lost reply is retried')
  assert.ok(received.includes('HEARTBEAT'), 'the GCS heartbeat reaches the vehicle')
  assert.ok(received.includes('MISSION_ACK'))
  assert.equal(requested, 242, 'HOME_POSITION is requested')
  link.close()
  vehicle.close()
  // The port is free again after close.
  ;(await openLink(port)).close()
}

console.log('ok — MAVLink bridge: targeting, staleness, retries, UDP round trip')

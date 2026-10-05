// MAVLink telemetry and mission download over UDP; no flight-control API.
// Runs in Electron's main process. Kept free of electron imports so tsx can test it.
import { createSocket } from 'node:dgram'
import { PassThrough } from 'node:stream'
import {
  ardupilotmega, common, minimal, MavLinkPacketParser, MavLinkPacketSplitter, MavLinkProtocolV2,
  type MavLinkData, type MavLinkPacket,
} from 'node-mavlink'
import type { DownloadedMission, Telemetry } from '../lib/mavlink'

export const STALE_MS = 5000
const MISSION_TIMEOUT_MS = 20000
const RETRY_MS = 1500
const REGISTRY = { ...minimal.REGISTRY, ...common.REGISTRY, ...ardupilotmega.REGISTRY }
const AUTOPILOT_INVALID = 8
const ARDUPILOT = 3

// ArduPilot custom_mode names by MAV_TYPE, as in pymavlink's mode_string_v10.
const PLANE = { 0: 'MANUAL', 1: 'CIRCLE', 2: 'STABILIZE', 3: 'TRAINING', 4: 'ACRO', 5: 'FBWA', 6: 'FBWB', 7: 'CRUISE', 8: 'AUTOTUNE', 10: 'AUTO', 11: 'RTL', 12: 'LOITER', 13: 'TAKEOFF', 14: 'AVOID_ADSB', 15: 'GUIDED', 16: 'INITIALISING', 17: 'QSTABILIZE', 18: 'QHOVER', 19: 'QLOITER', 20: 'QLAND', 21: 'QRTL', 22: 'QAUTOTUNE', 23: 'QACRO', 24: 'THERMAL', 25: 'LOITERALTQLAND', 26: 'AUTOLAND' }
const COPTER = { 0: 'STABILIZE', 1: 'ACRO', 2: 'ALT_HOLD', 3: 'AUTO', 4: 'GUIDED', 5: 'LOITER', 6: 'RTL', 7: 'CIRCLE', 8: 'POSITION', 9: 'LAND', 10: 'OF_LOITER', 11: 'DRIFT', 13: 'SPORT', 14: 'FLIP', 15: 'AUTOTUNE', 16: 'POSHOLD', 17: 'BRAKE', 18: 'THROW', 19: 'AVOID_ADSB', 20: 'GUIDED_NOGPS', 21: 'SMART_RTL', 22: 'FLOWHOLD', 23: 'FOLLOW', 24: 'ZIGZAG', 25: 'SYSTEMID', 26: 'AUTOROTATE', 27: 'AUTO_RTL', 28: 'TURTLE', 29: 'RATE_ACRO' }
const ROVER = { 0: 'MANUAL', 1: 'ACRO', 2: 'LEARNING', 3: 'STEERING', 4: 'HOLD', 5: 'LOITER', 6: 'FOLLOW', 7: 'SIMPLE', 8: 'DOCK', 9: 'CIRCLE', 10: 'AUTO', 11: 'RTL', 12: 'SMART_RTL', 15: 'GUIDED', 16: 'INITIALISING' }
const SUB = { 0: 'STABILIZE', 1: 'ACRO', 2: 'ALT_HOLD', 3: 'AUTO', 4: 'GUIDED', 7: 'CIRCLE', 9: 'SURFACE', 16: 'POSHOLD', 19: 'MANUAL' }
const TRACKER = { 0: 'MANUAL', 1: 'STOP', 2: 'SCAN', 4: 'GUIDED', 10: 'AUTO', 16: 'INITIALISING' }
const MODES: Record<number, Record<number, string>> = {
  1: PLANE, 19: PLANE, 20: PLANE, 21: PLANE,
  2: COPTER, 3: COPTER, 4: COPTER, 13: COPTER, 14: COPTER, 15: COPTER, 29: COPTER, 35: COPTER,
  10: ROVER, 11: ROVER, 12: SUB, 5: TRACKER,
}

function modeName(type: number, baseMode: number, customMode: number) {
  // ponytail: PX4 modes show as Mode(n); downloads only support ArduPilot anyway.
  if (!(baseMode & 1)) return `Mode(0x${baseMode.toString(16).padStart(8, '0')})`
  return MODES[type]?.[customMode] ?? `Mode(${customMode})`
}

/** A decoded message: payload fields plus its name and source. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { name: string; sysid: number; compid: number; [field: string]: any }

type State = Omit<Telemetry, 'connected' | 'heartbeatAge'>
const emptyState = (): State => ({
  vehicle: null, position: null, home: null, attitude: null, battery: null, gps: null, statusText: null,
})

export function message<T extends MavLinkData>(Type: new () => T, fields: Partial<T>): T {
  return Object.assign(new Type(), fields)
}

export class Bridge {
  target: [system: number, component: number] | null = null
  lastHeartbeat: number | null = null
  updated: Partial<Record<keyof State, number>> = {}
  private state = emptyState()
  private lastSent = -Infinity
  private lastConfigured = -Infinity
  private waiters = new Set<(m: Msg) => void>()
  private downloading = false

  constructor(private send: (data: MavLinkData) => void, private now = () => performance.now()) {}

  snapshot(): Telemetry {
    const now = this.now()
    const age = this.lastHeartbeat === null ? null : now - this.lastHeartbeat
    const connected = age !== null && age < STALE_MS
    const fresh = <K extends 'position' | 'attitude' | 'battery' | 'gps'>(key: K) =>
      connected && now - (this.updated[key] ?? -Infinity) < STALE_MS ? this.state[key] : null
    return {
      ...this.state, connected, heartbeatAge: age === null ? null : age / 1000,
      position: fresh('position'), attitude: fresh('attitude'), battery: fresh('battery'), gps: fresh('gps'),
      home: connected ? this.state.home : null,
    }
  }

  handle(m: Msg) {
    this.update(m)
    for (const waiter of this.waiters) waiter(m)
  }

  private isTarget(m: Msg) {
    return this.target !== null && m.sysid === this.target[0] && m.compid === this.target[1]
  }

  update(m: Msg) {
    const now = this.now()
    if (m.name === 'HEARTBEAT') {
      // Select an autopilot, never a GCS, camera, or companion heartbeat.
      if (m.autopilot === AUTOPILOT_INVALID) return
      if (this.target && !this.isTarget(m)) return
      this.target = [m.sysid, m.compid]
      if (this.lastHeartbeat === null || now - this.lastHeartbeat >= STALE_MS) {
        this.state = emptyState()
        this.updated = {}
        this.lastConfigured = -Infinity
      }
      this.lastHeartbeat = now
      this.state.vehicle = {
        systemId: m.sysid, componentId: m.compid, autopilot: m.autopilot, type: m.type,
        mode: modeName(m.type, m.baseMode, m.customMode), armed: Boolean(m.baseMode & 128),
      }
      return
    }
    if (!this.isTarget(m)) return
    const set = <K extends keyof State>(key: K, value: State[K]) => {
      this.state[key] = value
      this.updated[key] = now
    }
    switch (m.name) {
      case 'GLOBAL_POSITION_INT':
        if (m.lat !== 0 || m.lon !== 0) set('position', {
          lat: m.lat / 1e7, lon: m.lon / 1e7, altAmsl: m.alt / 1000, relativeAlt: m.relativeAlt / 1000,
          heading: m.hdg === 65535 ? null : m.hdg / 100, groundSpeed: Math.hypot(m.vx, m.vy) / 100,
        })
        break
      case 'HOME_POSITION':
        if (m.latitude !== 0 || m.longitude !== 0) {
          set('home', { lat: m.latitude / 1e7, lon: m.longitude / 1e7, alt: m.altitude / 1000 })
        }
        break
      case 'ATTITUDE': {
        const deg = (r: number) => (r * 180) / Math.PI
        set('attitude', { roll: deg(m.roll), pitch: deg(m.pitch), yaw: ((deg(m.yaw) % 360) + 360) % 360 })
        break
      }
      case 'SYS_STATUS':
        set('battery', {
          voltage: m.voltageBattery === 65535 ? null : m.voltageBattery / 1000,
          remaining: m.batteryRemaining < 0 ? null : m.batteryRemaining,
        })
        break
      case 'GPS_RAW_INT':
        set('gps', { fix: m.fixType, satellites: m.satellitesVisible === 255 ? null : m.satellitesVisible })
        break
      case 'STATUSTEXT':
        set('statusText', String(m.text).replace(/\0.*$/s, ''))
        break
    }
  }

  /** Call a few times a second: GCS heartbeat each second, stream requests every 10 s. */
  tick() {
    if (!this.target) return
    const now = this.now()
    const [targetSystem, targetComponent] = this.target
    if (now - this.lastSent >= 1000) {
      this.send(message(minimal.Heartbeat, { type: 6, autopilot: AUTOPILOT_INVALID, mavlinkVersion: 3 }))
      this.lastSent = now
    }
    if (this.snapshot().connected && now - this.lastConfigured >= 10000) {
      this.send(message(common.RequestDataStream, {
        targetSystem, targetComponent, reqStreamId: 0, reqMessageRate: 4, startStop: 1,
      }))
      this.send(message(common.CommandLong, {
        targetSystem, targetComponent, command: 512, _param1: 242, // MAV_CMD_REQUEST_MESSAGE HOME_POSITION
      }))
      this.lastConfigured = now
    }
  }

  /** Resolves with the next accepted mission reply from the target, or null after `ms`. */
  private next(accept: (m: Msg) => boolean, ms: number) {
    return new Promise<Msg | null>((resolve, reject) => {
      const finish = (m: Msg | null, error?: Error) => {
        clearTimeout(timer)
        this.waiters.delete(waiter)
        if (error) reject(error)
        else resolve(m)
      }
      const timer = setTimeout(() => finish(null), Math.max(0, ms))
      const waiter = (m: Msg) => {
        if (!this.isTarget(m) || (m.missionType ?? 0) !== 0) return
        if (![0, 255].includes(m.targetSystem ?? 255) || ![0, 190].includes(m.targetComponent ?? 190)) return
        if (m.name === 'MISSION_ACK' && m.type !== 0) {
          return finish(null, new Error(`Autopilot rejected mission download (result ${m.type}).`))
        }
        if (accept(m)) finish(m)
      }
      this.waiters.add(waiter)
    })
  }

  /** MAVLink mission transfers retry requests when replies are lost. */
  async exchange(send: () => void, accept: (m: Msg) => boolean, deadline: number) {
    for (let attempt = 0; attempt < 3; attempt++) {
      send()
      const reply = await this.next(accept, Math.min(deadline, this.now() + RETRY_MS) - this.now())
      if (reply) return reply
      if (this.now() >= deadline) break
    }
    throw new Error('Mission download timed out. Check the MAVLink connection and retry.')
  }

  async download(): Promise<DownloadedMission> {
    if (this.downloading) throw new Error('A mission download is already in progress.')
    const state = this.snapshot()
    if (!state.connected || !state.vehicle || !this.target) throw new Error('No recent autopilot heartbeat.')
    if (state.vehicle.autopilot !== ARDUPILOT) throw new Error('Mission download currently supports ArduPilot vehicles.')
    this.downloading = true
    try {
      const [targetSystem, targetComponent] = this.target
      const deadline = this.now() + MISSION_TIMEOUT_MS
      const { count } = await this.exchange(
        () => this.send(message(common.MissionRequestList, { targetSystem, targetComponent, missionType: 0 })),
        (m) => m.name === 'MISSION_COUNT', deadline)
      if (count > 512) throw new Error('This version supports missions with at most 512 items.')
      const items: DownloadedMission['items'] = []
      for (let seq = 0; seq < count; seq++) {
        const m = await this.exchange(
          () => this.send(message(common.MissionRequestInt, { targetSystem, targetComponent, seq, missionType: 0 })),
          (m) => m.name === 'MISSION_ITEM_INT' && m.seq === seq, deadline)
        if (!Number.isFinite(m.z)) throw new Error(`Mission item ${seq} contains an invalid altitude.`)
        items.push({
          seq: m.seq, frame: m.frame, command: m.command, x: m.x, y: m.y, z: m.z,
          // Unspecified command parameters are NaN on the wire.
          params: [m.param1, m.param2, m.param3, m.param4].map((p) => (Number.isFinite(p) ? p : null)),
        })
      }
      this.send(message(common.MissionAck, { targetSystem, targetComponent, type: 0, missionType: 0 }))
      return { items, home: this.snapshot().home, autopilot: state.vehicle.autopilot }
    } finally {
      this.downloading = false
    }
  }
}

export function decode(packet: MavLinkPacket): Msg | null {
  const Type = REGISTRY[packet.header.msgid]
  if (!Type) return null
  return { ...packet.protocol.data(packet.payload, Type), name: Type.MSG_NAME,
    sysid: packet.header.sysid, compid: packet.header.compid }
}

export type Link = { bridge: Bridge; close(): void }

/**
 * Listens like pymavlink's udpin: replies go to whoever sent the last datagram.
 * ponytail: UDP only. Add `serialport` when someone needs a USB radio without a GCS forwarding it.
 */
export function openLink(port = 14550, host = '127.0.0.1'): Promise<Link> {
  const socket = createSocket('udp4')
  const protocol = new MavLinkProtocolV2(255, 190)
  let remote: { address: string; port: number } | null = null
  let seq = 0
  const bridge = new Bridge((data) => {
    if (remote) socket.send(protocol.serialize(data, seq++ & 255), remote.port, remote.address)
  })
  const input = new PassThrough()
  input.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser()).on('data', (packet: MavLinkPacket) => {
    const m = decode(packet)
    if (m) bridge.handle(m)
  })
  socket.on('message', (buffer, sender) => {
    remote = sender
    input.write(buffer)
  })
  return new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(port, host, () => {
      socket.off('error', reject)
      socket.on('error', () => {}) // Send failures surface as missing replies and time out.
      const timer = setInterval(() => bridge.tick(), 250)
      resolve({
        bridge,
        close() {
          clearInterval(timer)
          socket.close()
          input.destroy()
        },
      })
    })
  })
}

import { parsePlan, type RawMission } from './mission'

export type VehiclePosition = {
  lat: number
  lon: number
  altAmsl: number
  relativeAlt: number
  heading: number | null
  groundSpeed: number
}

export type Telemetry = {
  connected: boolean
  heartbeatAge: number | null
  vehicle: {
    systemId: number
    componentId: number
    autopilot: number
    type: number
    mode: string
    armed: boolean
  } | null
  position: VehiclePosition | null
  home: RawMission['home']
  attitude: { roll: number; pitch: number; yaw: number } | null
  battery: { voltage: number | null; remaining: number | null } | null
  gps: { fix: number; satellites: number | null } | null
  statusText: string | null
}

export type DownloadedMission = {
  autopilot: number
  home: RawMission['home']
  items: {
    seq: number
    frame: number
    command: number
    x: number
    y: number
    z: number
    params: (number | null)[]
  }[]
}

/** ArduPilot item zero is home; QGC file parsing alone cannot express that rule. */
export function missionFromMavlink(download: DownloadedMission): RawMission {
  if (download.autopilot !== 3) throw new Error('Mission download currently supports ArduPilot vehicles.')
  const frames = new Set([0, 3, 5, 6, 10, 11])
  const first = download.items[0]
  const home = download.home ?? (first?.seq === 0 && (first.frame === 0 || first.frame === 5) &&
    (first.x !== 0 || first.y !== 0)
    ? { lat: first.x / 1e7, lon: first.y / 1e7, alt: first.z }
    : null)
  if (home && (!Number.isFinite(home.alt) || !Number.isFinite(home.lat) || !Number.isFinite(home.lon) ||
    Math.abs(home.lat) > 90 || Math.abs(home.lon) > 180)) {
    throw new Error('Vehicle home contains invalid coordinates or altitude.')
  }
  const items = download.items.filter((item) => item.seq !== 0)
  for (const item of items) {
    if ((!frames.has(item.frame) && item.frame !== 2) || (item.frame === 2 && (item.x !== 0 || item.y !== 0))) {
      throw new Error(`Mission item ${item.seq} uses unsupported coordinate frame ${item.frame}.`)
    }
    if (!Number.isFinite(item.z) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) {
      throw new Error(`Mission item ${item.seq} contains invalid coordinates.`)
    }
    if (frames.has(item.frame) && (Math.abs(item.x / 1e7) > 90 || Math.abs(item.y / 1e7) > 180)) {
      throw new Error(`Mission item ${item.seq} has coordinates outside the valid range.`)
    }
  }
  const mission = parsePlan(JSON.stringify({ mission: {
    plannedHomePosition: home ? [home.lat, home.lon, home.alt] : undefined,
    items: items.map((item) => ({ type: 'SimpleItem', command: item.command, frame: item.frame,
      params: [...item.params, item.x / 1e7, item.y / 1e7, item.z] })),
  } }))
  if (!home && mission.waypoints.some((wp) => wp.frame === 'relative')) {
    throw new Error('Vehicle home is unavailable; relative mission altitudes cannot be checked yet.')
  }
  return { ...mission, source: 'mavlink' }
}

export function missionLaunchAmsl(mission: RawMission, terrainAmsl: number): number {
  // A live autopilot's relative frame is anchored to its reported HOME_POSITION,
  // which can differ from a DEM elevation. Imported files retain the existing rule.
  return mission.source === 'mavlink' && mission.home ? mission.home.alt : terrainAmsl
}

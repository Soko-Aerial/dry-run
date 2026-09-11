/**
 * Mission import. Two formats, one output.
 *
 *   ArduPilot .waypoints  — Mission Planner. Tab-separated MAVLink commands.
 *   QGC .plan             — QGroundControl. JSON.
 *
 * Altitudes arrive in three different frames and are ALL converted to AMSL
 * before anything else touches them. See DESIGN.md #7 — this is the step that,
 * skipped, produces a confident all-clear on a mission that flies into a hill.
 */

export type AltFrame = 'amsl' | 'relative' | 'terrain'

export type RawWaypoint = {
  lat: number
  lon: number
  alt: number
  frame: AltFrame
  command: number
}

export type RawMission = {
  home: { lat: number; lon: number; alt: number } | null
  waypoints: RawWaypoint[]
  source: 'waypoints' | 'plan'
  warnings: string[]
}

// MAV_FRAME
const FRAMES: Record<number, AltFrame> = {
  0: 'amsl', // GLOBAL
  3: 'relative', // GLOBAL_RELATIVE_ALT
  6: 'relative', // GLOBAL_RELATIVE_ALT_INT
  10: 'terrain', // GLOBAL_TERRAIN_ALT
  11: 'terrain', // GLOBAL_TERRAIN_ALT_INT
}

// MAV_CMD values that carry a position we should fly to. Anything not here is
// a DO_/CONDITION_ command with no coordinate. Too narrow a set silently drops
// waypoints — VTOL takeoff/land (84/85) are an easy miss.
const NAV_COMMANDS = new Set([
  16, // WAYPOINT
  17, // LOITER_UNLIM
  18, // LOITER_TURNS
  19, // LOITER_TIME
  21, // LAND
  22, // TAKEOFF
  31, // LOITER_TO_ALT
  82, // SPLINE_WAYPOINT
  84, // VTOL_TAKEOFF
  85, // VTOL_LAND
])

/** Sniff the format. .plan is JSON, .waypoints starts with a WPL header. */
export function parseMission(text: string): RawMission {
  const t = text.trim()
  return t.startsWith('{') ? parsePlan(t) : parseWaypoints(t)
}

function frameOf(n: number, warnings: string[]): AltFrame {
  const f = FRAMES[n]
  if (!f) {
    warnings.push(`Unknown altitude frame ${n}, assumed relative to launch`)
    return 'relative'
  }
  return f
}

export function parseWaypoints(text: string): RawMission {
  const warnings: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!/^QGC WPL/i.test(lines[0])) {
    warnings.push('Missing "QGC WPL" header — parsed anyway, verify the result')
  } else {
    lines.shift()
  }

  const waypoints: RawWaypoint[] = []
  let home: RawMission['home'] = null

  for (const line of lines) {
    const c = line.split(/\t|\s+/).filter((s) => s !== '')
    if (c.length < 12) continue
    const index = Number(c[0])
    const frameN = Number(c[2])
    const command = Number(c[3])
    const lat = Number(c[8])
    const lon = Number(c[9])
    const alt = Number(c[10])

    // Line 0 is the home position, whatever its command says.
    if (index === 0) {
      home = { lat, lon, alt }
      continue
    }
    // DO_ / CONDITION_ commands carry no position.
    if (!NAV_COMMANDS.has(command)) continue
    if (lat === 0 && lon === 0) continue

    waypoints.push({ lat, lon, alt, frame: frameOf(frameN, warnings), command })
  }

  return { home, waypoints, source: 'waypoints', warnings: dedupe(warnings) }
}

export function parsePlan(text: string): RawMission {
  const warnings: string[] = []
  const doc = JSON.parse(text)
  const mission = doc.mission ?? doc
  const hp = mission.plannedHomePosition
  const home = Array.isArray(hp) ? { lat: hp[0], lon: hp[1], alt: hp[2] ?? 0 } : null

  const waypoints: RawWaypoint[] = []

  const walk = (items: unknown[]) => {
    for (const raw of items) {
      const item = raw as Record<string, unknown>
      if (item.type === 'ComplexItem') {
        // Survey grids and corridor scans hold their real waypoints nested.
        const nested =
          (item.TransectStyleComplexItem as Record<string, unknown> | undefined)?.Items ??
          item.Items
        if (Array.isArray(nested)) {
          walk(nested)
        } else {
          warnings.push(
            `Complex item "${String(item.complexItemType ?? 'unknown')}" could not be expanded — its waypoints are missing from this check`,
          )
        }
        continue
      }
      const command = Number(item.command)
      if (!NAV_COMMANDS.has(command)) continue
      // Two shapes in the wild: older files carry `coordinate`, newer ones put
      // lat/lon/alt in MAVLink params 5-7. Reading only one silently drops
      // every waypoint and reports an empty mission.
      const coord = item.coordinate as number[] | undefined
      const params = item.params as number[] | undefined
      const [lat, lon, alt] = Array.isArray(coord) && coord.length >= 3
        ? [coord[0], coord[1], coord[2]]
        : [params?.[4], params?.[5], params?.[6]]
      if (lat == null || lon == null || (lat === 0 && lon === 0)) continue
      waypoints.push({
        lat,
        lon,
        alt: Number(alt),
        frame: frameOf(Number(item.frame), warnings),
        command,
      })
    }
  }
  walk(Array.isArray(mission.items) ? mission.items : [])

  return { home, waypoints, source: 'plan', warnings: dedupe(warnings) }
}

const dedupe = (a: string[]) => [...new Set(a)]

export type ResolvedWaypoint = {
  lat: number
  lon: number
  /** AMSL metres — the only frame anything downstream sees. */
  alt: number
  /** what the pilot typed, and in which frame, for display */
  planned: number
  frame: AltFrame
}

/**
 * Convert every frame to AMSL.
 *   launchAmsl comes from the terrain under home, not from the pilot (DESIGN.md #9).
 *   terrainAt takes lat/lon, returns AMSL metres.
 */
export function toAmsl(
  wps: RawWaypoint[],
  launchAmsl: number,
  terrainAt: (lat: number, lon: number) => number,
): ResolvedWaypoint[] {
  return wps.map((w) => ({
    lat: w.lat,
    lon: w.lon,
    planned: w.alt,
    frame: w.frame,
    alt:
      w.frame === 'amsl'
        ? w.alt
        : w.frame === 'relative'
          ? launchAmsl + w.alt
          : terrainAt(w.lat, w.lon) + w.alt,
  }))
}

/**
 * Local ENU metres about an origin.
 * ponytail: equirectangular. ~0.1% over a survey-sized area; swap for a proper
 * projection only if missions ever span tens of km.
 */
export function enuFactors(originLat: number) {
  return { lat: 110574, lon: 111320 * Math.cos((originLat * Math.PI) / 180) }
}

export function toEnu(
  wps: { lat: number; lon: number; alt: number }[],
  origin: { lat: number; lon: number },
) {
  const f = enuFactors(origin.lat)
  return wps.map((w) => ({
    e: (w.lon - origin.lon) * f.lon,
    n: (w.lat - origin.lat) * f.lat,
    alt: w.alt,
  }))
}

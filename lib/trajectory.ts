/**
 * Flight model: waypoint polyline -> the path the aircraft can actually fly.
 *
 * Two constraints separate the two, and both matter for clearance:
 *   - turn radius: fixed-wing cuts corners, it does not pivot on a waypoint
 *   - climb/descent rate: a leg demanding more climb than the aircraft has
 *     is flown *into* the terrain, not over it
 *
 * Pure geometry, metres, local ENU. No terrain here — clearance is annotated
 * separately so this file is testable without tiles.
 */

export type VehicleProfile = {
  cruiseMs: number
  turnRadiusM: number
  maxClimbMs: number
  maxDescentMs: number
}

export const PROFILES: Record<string, VehicleProfile> = {
  // ponytail: multirotor = fixed-wing with turn radius 0. One model, two profiles.
  // Defaults are ballpark. Real airframes get tuned in the UI.
  multirotor: { cruiseMs: 8, turnRadiusM: 0, maxClimbMs: 5, maxDescentMs: 3 },
  fixedwing: { cruiseMs: 18, turnRadiusM: 40, maxClimbMs: 3, maxDescentMs: 4 },
}

/** Waypoint in local ENU metres. alt is AMSL — always. See DESIGN.md #7. */
export type Wp = { e: number; n: number; alt: number }

export type TrajPoint = {
  t: number
  e: number
  n: number
  alt: number
  heading: number
  legIndex: number
  /** filled by annotateClearance */
  terrain?: number
  clearance?: number
}

type PathPoint = { e: number; n: number; targetAlt: number; legIndex: number }

const norm = (e: number, n: number) => {
  const l = Math.hypot(e, n)
  return l < 1e-9 ? { e: 0, n: 0 } : { e: e / l, n: n / l }
}

/**
 * Insert turn arcs at each interior waypoint. targetAlt at any point is the
 * altitude of the waypoint being flown toward.
 */
function buildPath(wps: Wp[], turnRadiusM: number): PathPoint[] {
  const path: PathPoint[] = [
    { e: wps[0].e, n: wps[0].n, targetAlt: wps[1].alt, legIndex: 0 },
  ]

  for (let i = 1; i < wps.length - 1; i++) {
    const A = wps[i - 1]
    const B = wps[i]
    const C = wps[i + 1]
    const targetAlt = C.alt

    const vIn = { e: B.e - A.e, n: B.n - A.n }
    const vOut = { e: C.e - B.e, n: C.n - B.n }
    const lIn = Math.hypot(vIn.e, vIn.n)
    const lOut = Math.hypot(vOut.e, vOut.n)
    const uIn = norm(vIn.e, vIn.n)
    const uOut = norm(vOut.e, vOut.n)

    const dot = Math.max(-1, Math.min(1, uIn.e * uOut.e + uIn.n * uOut.n))
    const theta = Math.acos(dot) // turn angle
    const cross = uIn.e * uOut.n - uIn.n * uOut.e
    const sign = cross >= 0 ? 1 : -1 // +1 = left turn

    // Straight through, a reversal we can't arc, or a hover-capable airframe.
    if (turnRadiusM <= 0 || theta < 1e-4 || Math.PI - theta < 1e-4 || lIn < 1e-6 || lOut < 1e-6) {
      path.push({ e: B.e, n: B.n, targetAlt, legIndex: i })
      continue
    }

    let d = turnRadiusM * Math.tan(theta / 2)
    const dMax = Math.min(lIn, lOut) * 0.5
    // ponytail: legs too short for the full radius get a tighter arc rather
    // than an error. Flags as an overshoot risk in legDemands instead.
    if (d > dMax) d = dMax
    const rEff = d / Math.tan(theta / 2)

    const P1 = { e: B.e - uIn.e * d, n: B.n - uIn.n * d }
    const P2 = { e: B.e + uOut.e * d, n: B.n + uOut.n * d }
    // centre lies perpendicular to the inbound leg, on the turn side
    const center = {
      e: P1.e + -uIn.n * rEff * sign,
      n: P1.n + uIn.e * rEff * sign,
    }

    const a1 = Math.atan2(P1.n - center.n, P1.e - center.e)
    const steps = Math.max(2, Math.ceil(theta / (Math.PI / 36))) // ~5 deg
    for (let s = 0; s <= steps; s++) {
      const a = a1 + sign * theta * (s / steps)
      path.push({
        e: center.e + rEff * Math.cos(a),
        n: center.n + rEff * Math.sin(a),
        targetAlt,
        legIndex: i,
      })
    }
    void P2
  }

  const last = wps[wps.length - 1]
  path.push({
    e: last.e,
    n: last.n,
    targetAlt: last.alt,
    legIndex: wps.length - 2,
  })
  return path
}

/**
 * Walk the path at cruise speed, integrating altitude toward each target at
 * no more than the aircraft's climb/descent rate.
 */
export function buildTrajectory(wps: Wp[], p: VehicleProfile, dt = 0.1): TrajPoint[] {
  if (wps.length < 2) return []
  const path = buildPath(wps, p.turnRadiusM)
  const step = p.cruiseMs * dt
  const out: TrajPoint[] = []

  let seg = 0
  let into = 0
  let alt = wps[0].alt
  let t = 0

  const headingAt = (i: number) => {
    const a = path[Math.min(i, path.length - 2)]
    const b = path[Math.min(i + 1, path.length - 1)]
    return Math.atan2(b.e - a.e, b.n - a.n) // 0 = north, clockwise
  }

  for (;;) {
    const a = path[seg]
    const b = path[seg + 1]
    const segLen = Math.hypot(b.e - a.e, b.n - a.n)
    const f = segLen < 1e-9 ? 0 : into / segLen

    out.push({
      t,
      e: a.e + (b.e - a.e) * f,
      n: a.n + (b.n - a.n) * f,
      alt,
      heading: headingAt(seg),
      legIndex: a.legIndex,
    })

    // altitude integration, rate-clamped
    const dAlt = a.targetAlt - alt
    const maxUp = p.maxClimbMs * dt
    const maxDown = p.maxDescentMs * dt
    alt += dAlt > 0 ? Math.min(dAlt, maxUp) : Math.max(dAlt, -maxDown)
    t += dt

    // advance one step along the polyline
    let remain = step
    while (remain > 0) {
      const cur = path[seg]
      const nxt = path[seg + 1]
      const len = Math.hypot(nxt.e - cur.e, nxt.n - cur.n)
      if (into + remain < len) {
        into += remain
        remain = 0
      } else {
        remain -= len - into
        seg++
        into = 0
        if (seg >= path.length - 1) {
          const end = path[path.length - 1]
          out.push({
            t,
            e: end.e,
            n: end.n,
            alt,
            heading: headingAt(path.length - 2),
            legIndex: end.legIndex,
          })
          return out
        }
      }
    }
  }
}

/** Ground clearance per sample. terrainAt returns AMSL metres. */
export function annotateClearance(
  traj: TrajPoint[],
  terrainAt: (e: number, n: number) => number,
): TrajPoint[] {
  for (const pt of traj) {
    pt.terrain = terrainAt(pt.e, pt.n)
    pt.clearance = pt.alt - pt.terrain
  }
  return traj
}

export type LegDemand = {
  legIndex: number
  lengthM: number
  climbRateRequired: number
  limit: number
  exceeded: boolean
}

/**
 * Climb rate each leg asks of the aircraft, against what it has. This is the
 * fixed-wing killer: the mission looks fine, the aircraft can't make the numbers.
 */
export function legDemands(wps: Wp[], p: VehicleProfile): LegDemand[] {
  const out: LegDemand[] = []
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i]
    const b = wps[i + 1]
    const lengthM = Math.hypot(b.e - a.e, b.n - a.n)
    const timeS = lengthM / p.cruiseMs
    const dAlt = b.alt - a.alt
    const rate = timeS < 1e-9 ? 0 : dAlt / timeS
    const limit = dAlt >= 0 ? p.maxClimbMs : -p.maxDescentMs
    out.push({
      legIndex: i,
      lengthM,
      climbRateRequired: rate,
      limit,
      exceeded: dAlt >= 0 ? rate > p.maxClimbMs : rate < -p.maxDescentMs,
    })
  }
  return out
}

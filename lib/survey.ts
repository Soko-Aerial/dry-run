/**
 * The pipeline: mission file in, dry run + verdict out.
 * Everything here is derived from data already fetched. No extra requests.
 */
import { parseMission, toAmsl, toEnu, enuFactors, type RawMission, type ResolvedWaypoint } from './mission'
import { loadGrid, sampleAt, gridStats, bboxOf, type Grid } from './terrain'
import {
  buildTrajectory,
  annotateClearance,
  legDemands,
  type VehicleProfile,
  type TrajPoint,
  type LegDemand,
} from './trajectory'

export type Selection =
  | { kind: 'mission' }
  | { kind: 'vehicle' }
  | { kind: 'terrain' }
  | { kind: 'waypoint'; index: number }
  | { kind: 'leg'; index: number }

export type Survey = {
  mission: RawMission
  waypoints: ResolvedWaypoint[]
  origin: { lat: number; lon: number }
  grid: Grid
  traj: TrajPoint[]
  demands: LegDemand[]
  launchAmsl: number
  highestTerrain: number
  lowestTerrain: number
  minClearance: number
  minClearanceLeg: number
  distanceM: number
  durationS: number
  /** ground clearance at each waypoint, metres */
  waypointClearance: number[]
  /** worst clearance on each leg, metres */
  legMinClearance: number[]
  /** null until there are two waypoints — nothing to check yet */
  verdict: 'GO' | 'NO-GO' | null
  issues: string[]
}

export async function runSurvey(
  text: string,
  profile: VehicleProfile,
  thresholdM: number,
): Promise<Survey> {
  return surveyMission(parseMission(text), profile, thresholdM)
}

/** The same pipeline over waypoints already in memory — i.e. an edited mission. */
export async function surveyMission(
  mission: RawMission,
  profile: VehicleProfile,
  thresholdM: number,
): Promise<Survey> {
  const pts = [...mission.waypoints, ...(mission.home ? [mission.home] : [])]
  if (pts.length === 0) {
    throw new Error(['Mission contains no positions.', ...mission.warnings].join(' '))
  }
  const grid = await loadGrid(bboxOf(pts))

  // Launch elevation comes from the terrain, not the pilot (DESIGN.md #9).
  const homePt = mission.home ?? mission.waypoints[0]
  const launchAmsl = sampleAt(grid, homePt.lat, homePt.lon)
  const origin = { lat: homePt.lat, lon: homePt.lon }

  const waypoints = toAmsl(mission.waypoints, launchAmsl, (lat, lon) => sampleAt(grid, lat, lon))
  const waypointClearance = waypoints.map((w) => w.alt - sampleAt(grid, w.lat, w.lon))
  const { min: lowestTerrain, max: highestTerrain } = gridStats(grid)

  // Fewer than two waypoints is a site, not a mission: the terrain is real and
  // worth looking at, there is just no path to fly through it yet. Everything
  // downstream reads an empty trajectory as "nothing to check".
  if (waypoints.length < 2) {
    return {
      mission, waypoints, origin, grid,
      traj: [], demands: [],
      launchAmsl, highestTerrain, lowestTerrain,
      minClearance: Infinity, minClearanceLeg: 0,
      distanceM: 0, durationS: 0,
      waypointClearance, legMinClearance: [],
      verdict: null,
      issues: mission.warnings,
    }
  }

  const enu = toEnu(waypoints, origin)

  const f = enuFactors(origin.lat)
  const terrainAtEnu = (e: number, n: number) =>
    sampleAt(grid, origin.lat + n / f.lat, origin.lon + e / f.lon)

  const traj = annotateClearance(buildTrajectory(enu, profile), terrainAtEnu)
  const demands = legDemands(enu, profile)

  let minClearance = Infinity
  let minClearanceLeg = 0
  let distanceM = 0
  for (let i = 0; i < traj.length; i++) {
    const p = traj[i]
    if (p.clearance! < minClearance) {
      minClearance = p.clearance!
      minClearanceLeg = p.legIndex
    }
    if (i > 0) distanceM += Math.hypot(p.e - traj[i - 1].e, p.n - traj[i - 1].n)
    p.s = distanceM
  }

  const legMinClearance = demands.map(() => Infinity)
  for (const p of traj) {
    if (p.clearance! < legMinClearance[p.legIndex]) legMinClearance[p.legIndex] = p.clearance!
  }

  const issues: string[] = []
  if (minClearance < thresholdM) {
    issues.push(
      `Minimum terrain clearance ${minClearance.toFixed(0)}m on leg ${minClearanceLeg + 1} — below the ${thresholdM}m threshold`,
    )
  }
  for (const d of demands.filter((d) => d.exceeded)) {
    issues.push(
      `Leg ${d.legIndex + 1} demands ${Math.abs(d.climbRateRequired).toFixed(1)} m/s ${d.climbRateRequired > 0 ? 'climb' : 'descent'} — aircraft limit is ${Math.abs(d.limit)} m/s`,
    )
  }
  issues.push(...mission.warnings)

  return {
    mission,
    waypoints,
    origin,
    grid,
    traj,
    demands,
    launchAmsl,
    highestTerrain,
    lowestTerrain,
    minClearance,
    minClearanceLeg,
    distanceM,
    durationS: traj[traj.length - 1].t,
    waypointClearance,
    legMinClearance,
    verdict: minClearance < thresholdM || demands.some((d) => d.exceeded) ? 'NO-GO' : 'GO',
    issues,
  }
}

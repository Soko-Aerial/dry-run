// ponytail: three asserts, no framework. `pnpm test`
import { strict as assert } from 'node:assert'
import { buildTrajectory, annotateClearance, legDemands, PROFILES, type Wp } from './trajectory'

const fw = PROFILES.fixedwing
const mr = PROFILES.multirotor

// 1. A leg demanding more climb than the aircraft has is NOT flown as drawn.
{
  const wps: Wp[] = [
    { e: 0, n: 0, alt: 100 },
    { e: 0, n: 200, alt: 200 }, // +100m over 200m at 18m/s = 9m/s demanded, limit 3
  ]
  const d = legDemands(wps, fw)[0]
  assert.ok(d.exceeded, 'leg should exceed climb limit')
  assert.ok(Math.abs(d.climbRateRequired - 9) < 0.1, `demanded ${d.climbRateRequired}`)

  const traj = buildTrajectory(wps, fw)
  const arrived = traj[traj.length - 1].alt
  // ~11.1s of flight at 3 m/s = ~133m, nowhere near the planned 200m
  assert.ok(arrived < 140, `arrived at ${arrived}, should be climb-clamped well below 200`)
}

// 2. Fixed-wing cuts the corner; multirotor does not.
{
  const corner = { e: 0, n: 500 }
  const wps: Wp[] = [
    { e: 0, n: 0, alt: 100 },
    { e: 0, n: 500, alt: 100 },
    { e: 500, n: 500, alt: 100 },
  ]
  const minDist = (p: VehicleTraj) =>
    Math.min(...p.map((pt) => Math.hypot(pt.e - corner.e, pt.n - corner.n)))

  const cut = minDist(buildTrajectory(wps, fw))
  const square = minDist(buildTrajectory(wps, mr))

  // 90deg turn at r=40 passes ~16.6m inside the waypoint
  assert.ok(cut > 5 && cut < 40, `fixed-wing closest approach ${cut}, expected ~16.6`)
  assert.ok(square < 2, `multirotor should fly the corner, got ${square}`)
}

// 3. Flying level into a ridge reports negative clearance.
{
  const wps: Wp[] = [
    { e: 0, n: 0, alt: 100 },
    { e: 0, n: 500, alt: 100 },
  ]
  const ridge = (_e: number, n: number) => (n > 200 && n < 300 ? 150 : 0)
  const traj = annotateClearance(buildTrajectory(wps, mr), ridge)
  const worst = Math.min(...traj.map((p) => p.clearance!))
  assert.equal(worst, -50, `worst clearance ${worst}, expected -50`)
}

type VehicleTraj = ReturnType<typeof buildTrajectory>

console.log('ok — climb clamp, corner cut, ridge conflict')

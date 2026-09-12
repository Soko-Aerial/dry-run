# dry-run — terrain-aware pre-flight survey

Pilot loads a planned mission, watches the aircraft fly it in 3D over real
terrain, and gets a verdict on whether the terrain will be a problem.

## Scope

**v1** — terrain only. Import, 3D dry run, clearance verdict, survey panel,
edit the imported mission (drop, delete, re-altitude a waypoint).
**v2** — obstacles (OSM masts/towers/buildings), airspace, 2D profile chart,
drawing a mission from nothing, FPV camera, camera-footprint/coverage.

The v1 verdict says **"no terrain conflict"**, never "safe". ~10 m ground
sampling sees hills. It does not see power lines, masts, cranes or treelines.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Import missions; drawing is v2 | The GCS is where the aircraft's real mission comes from. Validate that artifact, not a copy. |
| 2 | Parse both ArduPilot `.waypoints` and QGC `.plan` | Mission Planner writes the former, QGC the latter. Sniff on load. |
| 3 | Fixed-wing **and** multirotor, one model | Multirotor is a fixed-wing with turn radius 0. One trajectory generator, two profiles. |
| 4 | Vehicle profile fully configurable | Paper specs lie; real airframes need tuning. |
| 5 | Mapbox terrain-DEM v1 tiles, z14 @2x | Only source that serves clearance checks, area max-height, and a 3D mesh from one fetch. `mapbox.terrain-rgb` is frozen since Dec 2021; DEM-v1 returned byte-identical tiles at z12/14/15 when compared, so the switch is free. |
| 6 | Tiles proxied server-side | Keeps the Mapbox key off the client. |
| 7 | **All altitudes converted to AMSL internally** | Clearance is `aircraftAMSL - terrainAMSL`. Single frame, one subtraction, no silent frame bugs. Frame numbers verified against MAVLink `common.xml`, not memory. |
| 8 | Display three numbers per waypoint | AMSL / above-launch / above-ground. Pilot thinks in the 2nd, terrain kills via the 3rd. |
| 9 | Launch elevation sampled from terrain | Home lat/lon is in the file. Don't make the pilot type a datum. |
| 10 | Mesh resolution ≠ clearance resolution | Mesh downsampled for framerate; clearance sampled every ~5 m on full-res data. Verdict wins if they disagree. |
| 11 | GO/NO-GO headline + per-leg breakdown | Binary alone can't be acted on; a flat list buries the one bad leg. |
| 12 | Clearance threshold configurable, default 30 m | Terrain and wind decide this, not the tool. |
| 13 | Trajectory precomputed to a flat array @10 Hz | Playback, scrub, and speed become array indexing. |
| 14 | Orbit + chase cameras | Orbit to inspect, chase to make it a dry run. FPV is v2. |
| 15 | Clearance drop-line under the aircraft | Perspective makes vertical gaps unjudgeable by eye. This is the element that makes 3D communicate clearance. |

## Flight model

Waypoint polyline != flown path. The polyline is not what gets validated.

- **Turn radius** — corners are cut by an arc of radius `turnRadiusM`. A
  multirotor's 0 makes this a no-op.
- **Climb/descent clamp** — vertical rate limited to `maxClimbMs` /
  `maxDescentMs` at `cruiseMs`. A leg demanding more climb than the aircraft
  has is exactly how a mission that looks fine flies into a hill.

Both applied *before* clearance is checked.

```js
const PROFILES = {
  multirotor: { cruiseMs: 8,  turnRadiusM: 0,  maxClimbMs: 5, maxDescentMs: 3 },
  fixedwing:  { cruiseMs: 18, turnRadiusM: 40, maxClimbMs: 3, maxDescentMs: 4 },
}
```

## Survey panel

Highest terrain in area (AMSL + above launch) · lowest terrain · launch
elevation · minimum clearance and which leg · total distance · estimated
flight time · max climb gradient demanded vs. aircraft limit · GO/NO-GO.

All derived from data already in memory. No extra fetches.

## UI

Rerun-style four-region shell, all panels resizable and collapsible:

| Region | Holds |
|---|---|
| Top bar | file open, airframe, panel toggles, theme |
| Left | mission tree — vehicle, terrain, waypoints, legs, each with its clearance and a warning marker |
| Centre | 3D viewport, orbit / chase |
| Bottom | playback + clearance profile |
| Right | inspector — properties of whatever is selected |

Selection is shared: clicking a waypoint in the tree or in 3D selects it in both,
pulls the camera toward it, and fills the inspector.

The clearance profile is the view where a conflict is obvious at a glance;
3D perspective hides vertical gaps. Its palette was validated with the dataviz
validator against the real panel surfaces (#ffffff light, #171717 dark) — all
six checks pass in both modes. The minimum-clearance band is deliberately
NEUTRAL, not red: red is reserved for an actual breach, and a red band makes a
mission that clears by 94m look alarming.

## Stack

Next.js App Router · react-three-fiber + drei · shadcn (`base-mira` preset,
Base UI) · next-themes · React/`useState` · Tailwind · Vercel.

No geo libraries — `.plan` is `JSON.parse`, terrain-RGB decode is one line of
arithmetic, the trajectory model is trig.

```
app/page.tsx                        UI shell, state, file input
app/api/tiles/[z]/[x]/[y]/route.ts  Mapbox proxy + cache
lib/mission.ts                      .waypoints/.plan -> waypoints (AMSL)
lib/trajectory.ts                   profile -> trajectory array + clearance
components/Scene.tsx                terrain mesh, aircraft, cameras
```

`lib/trajectory.ts` holds the only real logic and is the only file with a
test: climb clamped over limit, corner cut inside waypoint by turn radius,
leg under a ridge reports negative clearance. Three asserts, no framework.

| 16 | PNG decoded by hand, never via canvas | `createImageBitmap`/`drawImage`/`getImageData` is a rendering path and rounds. Observed losing one count in the red channel on Windows Chrome — a 6553.6 m elevation error that still looked like terrain. `DecompressionStream` makes an exact decoder ~70 lines with no dependency. |
| 18 | Editing works on the parsed mission, not the file text | A dropped waypoint inherits the altitude and frame of the one it follows, then re-runs the same pipeline. Re-serialising the file only to parse it again would be a round trip with nothing at the far end — and export is not a feature yet, so what you edit here never leaves the tool. |
| 17 | Unknown commands carrying a position produce a warning | Silently dropping a waypoint yields a confident verdict on a path that isn't the mission. |

## Open

- Real `.waypoints` export from Mission Planner, to verify parse assumptions
  before anyone flies on this.
- Mapbox key. Until it lands, the proxy serves synthetic terrain so the
  whole app is developable offline; swapping in real tiles is one line.

# dry run

Pre-flight site survey for drone missions. Load a mission file, fly it against
real terrain, and see whether the aircraft clears the ground everywhere along
the path — before anyone goes to the field.

![Alpine mission, NO-GO](docs/ui-dark.png)

## What it does

- Reads **ArduPilot `.waypoints`** and **QGC `.plan`** missions.
- Converts every altitude to AMSL (absolute, relative and terrain frames) and
  samples Mapbox terrain tiles under the route.
- Flies the mission with a configurable vehicle model — fixed-wing corner arcs
  from turn radius, or a multirotor that turns on the spot — and checks
  clearance at every sample.
- Verdict is **GO / NO-GO** against a configurable minimum clearance (30 m),
  with the offending legs listed.

## The view

Selecting anything — in the tree, in 3D, or on the profile — highlights it
everywhere. `Esc` clears the selection.

![Survey grid with a leg selected](docs/ui-selected.png)

The bottom panel is the clearance profile: terrain silhouette, the flight line
above it, the minimum-clearance band, and any breach in red. Scrub it to move
the aircraft.

Chase camera rides behind the aircraft; the drop-line under it is green while
clear, red when not.

![Chase camera](docs/ui-chase.png)

Light theme is the same data, same colours.

![Light theme](docs/ui-light.png)

## Running it

```bash
pnpm install
echo 'MAPBOX_TOKEN=pk.your_token' > .env.local   # without it, terrain is synthetic and the verdict is void
pnpm dev
pnpm test       # trajectory geometry, mission parsing, PNG decode
```

Sample missions are in `samples/`. `DESIGN.md` has the decisions and the flight
model.

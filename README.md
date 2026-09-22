# dry run

**Know before you fly.**

Check a drone route against real terrain.

<img src="docs/ui-dark.png" alt="A drone route crossing alpine terrain with a NO-GO result" width="100%">

## See the risk

Red is too low. Green is clear.

<img src="docs/ui-selected.png" alt="A selected flight leg shown on the map and height chart" width="100%">

## Fly the route

Press play. Scrub the chart. Chase the drone.

<img src="docs/ui-chase.png" alt="A chase view behind the drone" width="100%">

## Make a plan

Drop points on the map. Move them. Delete them.

Each change gets a new **GO** or **NO-GO** check.

<img src="docs/ui-light.png" alt="The app in light mode" width="100%">

## Run it

You need a [Mapbox token](https://account.mapbox.com/access-tokens/) for real terrain.

```bash
pnpm install
echo 'MAPBOX_TOKEN=pk.your_token' > .env.local
pnpm dev
```

Open `http://localhost:3000`.

Drop in an ArduPilot `.waypoints` file or a QGroundControl `.plan` file. Try one from [`samples/`](samples/).

```bash
pnpm test
```

Want the flight math? Read [`DESIGN.md`](DESIGN.md).

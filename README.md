# dry run

**Know before you fly.**

Check a drone route against real terrain.

![A drone route crossing alpine terrain with a NO-GO result](docs/ui-dark.png)

## See the risk

Red is too low. Green is clear.

![A selected flight leg shown on the map and height chart](docs/ui-selected.png)

## Fly the route

Press play. Scrub the chart. Chase the drone.

![A chase view behind the drone](docs/ui-chase.png)

## Make a plan

Drop points on the map. Move them. Delete them.

Each change gets a new **GO** or **NO-GO** check.

![The app in light mode](docs/ui-light.png)

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

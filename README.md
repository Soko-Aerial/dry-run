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

## Connect an ArduPilot vehicle

The local bridge uses [uv](https://docs.astral.sh/uv/) and Python 3.12 or later. Its dependencies are pinned in `tools/mavlink/uv.lock`; `uv` creates the environment automatically.

Start SITL in one terminal. On the current WSL setup:

```bash
/root/tools/ardupilot-sitl/start.sh
```

In another terminal, from this repository:

```bash
pnpm mavlink
```

The bridge listens for MAVLink on UDP `127.0.0.1:14550` and exposes a loopback-only HTTP service on port `8765`. Next.js proxies it through `/api/mavlink`; browser clients share the bridge's single MAVLink connection. Do not run another UDP listener (such as the earlier telemetry check) on port `14550` at the same time.

In the inspector’s **Vehicle** area, click **Connect MAVLink**. **Locate vehicle** loads terrain at its reported position and shows a teal live-position marker. **Download mission** imports the autopilot's mission into the terrain checks and selects the matching profile for Copter or Plane. The 3D aircraft and timeline remain the predicted mission playback; the teal marker is the live vehicle's map position.

Telemetry streams over Server-Sent Events from the bridge through Next.js to the browser, at up to two snapshots per second. Next.js forwards the stream without HTTP polling. A missing heartbeat for five seconds shows **Signal lost** and removes live data. Silent or broken streams clear cached telemetry; the browser automatically reconnects when the bridge returns. **Disconnect** closes this browser's stream; it does not stop SITL or disconnect other browser clients. Mission downloads remain HTTP POST requests.

Mission download currently supports ArduPilot, `MISSION_ITEM_INT`, and up to 512 mission items, with retries and a 20-second transfer deadline. ArduPilot item zero supplies home when `HOME_POSITION` is unavailable. Relative altitudes use the autopilot home elevation; imported files continue to use terrain-derived launch elevation. Unknown coordinate frames fail the download rather than being guessed. Existing mission-parser warnings about omitted commands still apply.

This first integration reads telemetry and downloads missions. Mission upload and flight commands are not exposed by the bridge.

For an alternate local MAVLink transport:

```bash
pnpm mavlink --connection tcp:127.0.0.1:5762
```

Stop the bridge with Ctrl+C. Restart it with the same command. To run the bridge protocol tests:

```bash
uv run --locked --project tools/mavlink python -m unittest discover -s tools/mavlink -p 'test_*.py'
pnpm test
```

## Deploy to Cloudflare

The existing `dry-run` Worker uses vinext and Wrangler. Next.js local development remains available through `pnpm dev`.

```bash
pnpm install --frozen-lockfile
pnpm deploy:vinext
```

This builds the app and deploys `dist/server/wrangler.json`, preserving dashboard variables and existing secrets. The deployed Worker needs its existing `MAPBOX_TOKEN` secret. GLB models use browser object URLs instead of server filesystem storage.

The hosted Worker cannot reach the loopback-only MAVLink bridge on your computer. Live telemetry currently requires the local app and bridge.

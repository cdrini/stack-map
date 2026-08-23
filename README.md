# stack-map

A visualization of the Open Library ops stack — baremetal servers, the VMs on
them, and the containers deployed to those VMs — with room to layer in
Graphite/Grafana metrics later (per-VM CPU, gunicorn/nginx/haproxy worker
occupancy, etc.) so slowness is visible at the level it's actually happening.

## Status

Topology (servers/VMs/containers/relationships) is rendered from a
hand-authored spec. Live metrics: Graphite's `/render` endpoint has no
`Access-Control-Allow-Origin` header, so the browser can't `fetch()` it
directly (confirmed — it's reachable, just not CORS-enabled), so `server/` is
a small FastAPI proxy that makes that request server-side instead and
re-exposes it generically (any `source`/`query` pair, not tied to one metric
or VM).

CPU is the first metric wired up: every VM and server gets a "CPU: Busy NN%"
badge (colored green→red), with `wait`/`steal` call-outs that only appear
when elevated enough to suggest the strain isn't purely compute-bound —
clicking a badge explains what the three mean. A "Live refresh (30s)" toggle
in the map toolbar (on by default) re-polls all of them on a shared timer.

## Spec format

`src/stack.yaml` names real internal Archive infrastructure, so it's never
committed — it's git-ignored, and the server reads it from disk at
`STACKMAP_SPEC_PATH` (defaulting to that same local path) and serves it to
the frontend at runtime via `GET /api/spec`, rather than it being bundled
into the build. A fresh clone needs to create this file itself before the
app shows anything.

It's a flat entity model: `servers`, `vms`, `containers`, each
with a stable `id`. VMs point at their server via `hostedOn`; containers point
at their VM via `hostedOn`. Flat rather than nested so relations that aren't
strict parent/child (e.g. an haproxy's backend pool spanning VMs across
servers) can be added later without restructuring.

The container list was hand-transcribed from openlibrary's
`compose.production.yaml` `profiles:` field (which pins each service to the
VM(s) it deploys to) — it will drift as that file changes, so re-check it
against compose.production.yaml periodically rather than trusting it's
current.

Any entity can carry its own `metrics: [{ type, source, query }]`, and the
top-level `metrics:` list applies a metric to every entity matching its
`filter` (e.g. `filter: { type: [vm, server] }`) instead of repeating it
per-entity — see the doc comments at the top of `src/stack.yaml` for the
full shape, including how the `cpu-busy`/`cpu-wait`/`cpu-steal` family works.

## Dev

```sh
npm install
npm run dev -- --host 0.0.0.0
```

## Metrics API (server/)

FastAPI proxy in front of Graphite/Prometheus, so the browser talks to this
instead of them directly. The real metrics-source hostnames name internal
Archive infrastructure, so they're never hardcoded or committed — copy
`server/.env.example` to `server/.env` (git-ignored) and fill in the real
values before running:

```sh
cd server
cp .env.example .env  # then edit .env with the real hostnames
uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

`GET /api/metrics/latest?source=<url>&query=<target>` → latest datapoint for
one Graphite target. `source` is checked against a small allowlist (from
`.env`, not the request) rather than proxying anywhere a caller asks.

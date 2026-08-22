# stack-map

A visualization of the Open Library ops stack — baremetal servers, the VMs on
them, and the containers deployed to those VMs — with room to layer in
Graphite/Grafana metrics later (per-VM CPU, gunicorn/nginx/haproxy worker
occupancy, etc.) so slowness is visible at the level it's actually happening.

## Status

Topology (servers/VMs/containers/relationships) is rendered from a
hand-authored spec. Live metrics are just starting: Graphite's `/render`
endpoint has no `Access-Control-Allow-Origin` header, so the browser can't
`fetch()` it directly (confirmed — it's reachable, just not CORS-enabled), so
`server/` is a small FastAPI proxy that makes that request server-side
instead. Currently wired up for exactly one metric on one VM
(`CpuMonitor.vue`, hardcoded to `ol-web0`'s load average) as a proof of
concept before rolling it out to every VM.

## Spec format

`src/stack.yaml` is a flat entity model: `servers`, `vms`, `containers`, each
with a stable `id`. VMs point at their server via `hostedOn`; containers point
at their VM via `hostedOn`. Flat rather than nested so relations that aren't
strict parent/child (e.g. an haproxy's backend pool spanning VMs across
servers) can be added later without restructuring.

The container list was hand-transcribed from openlibrary's
`compose.production.yaml` `profiles:` field (which pins each service to the
VM(s) it deploys to) — it will drift as that file changes, so re-check it
against compose.production.yaml periodically rather than trusting it's
current.

## Dev

```sh
npm install
npm run dev -- --host 0.0.0.0
```

## Metrics API (server/)

FastAPI proxy in front of Graphite, so the browser talks to this instead of
Graphite directly:

```sh
cd server
uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

`GET /api/vms/{vm_id}/load` → latest 1-minute load average for that VM, e.g.
`/api/vms/ol-web0/load`.

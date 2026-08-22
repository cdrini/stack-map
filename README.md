# stack-map

A visualization of the Open Library ops stack — baremetal servers, the VMs on
them, and the containers deployed to those VMs — with room to layer in
Graphite/Grafana metrics later (per-VM CPU, gunicorn/nginx/haproxy worker
occupancy, etc.) so slowness is visible at the level it's actually happening.

## Status

v1: static topology only, rendered from a hand-authored spec. No live metrics
wiring yet — that's a deliberate follow-up once the topology layout and spec
format hold up, and will likely need a small backend proxy in front of
Graphite/Grafana (to avoid doing auth/CORS from the browser).

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

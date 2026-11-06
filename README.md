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
against the compose files periodically rather than trusting it's current.
`server/compose_refs.py` covers most of that (see below): it can't invent an
entity for a service that's newly appeared, but it reports the ones nothing
in the spec points at, and keeps every `definition:` anchor correct itself.

Any entity can carry its own `metrics: [{ type, source, query }]`, and the
top-level `metrics:` list applies a metric to every entity matching its
`filter` (e.g. `filter: { type: [vm, server] }`) instead of repeating it
per-entity — see the doc comments at the top of `src/stack.yaml` for the
full shape, including how the `cpu-busy`/`cpu-wait`/`cpu-steal` family works.

A container can also carry `config:` — a link to the config file that drives
it, e.g. an haproxy's `haproxy.cfg` — shown as "View config" in its
right-click menu. Unlike `definition:` it's a whole-file link with no line
anchor, so it needs none of the recomputation below and can stay pointed at
`master`. Most containers aren't driven by a config file worth reading, so
it's simply left out of the menu when absent, rather than shown disabled the
way a missing `definition:` is.

## Scripts

`scripts/stackmap.py` reads and edits the spec; `scripts/collect-os.sh` goes
out and gathers facts and hands them to it. The split is deliberate — only
one of them knows the file format, and only one of them needs to reach the
hosts — and neither carries anything site-specific, since the spec is the
file that isn't committed.

```sh
scripts/stackmap.py vms                             # every VM id, one per line
scripts/stackmap.py get ol-web0 ip                  # one scalar field
scripts/stackmap.py set ol-web0 os=ubuntu           # set or add fields
scripts/collect-os.sh --dry-run                     # ssh every VM, report
scripts/collect-os.sh ol-web0 ol-db0                # or just these, and write
```

`stackmap.py` is standard library only, so it runs wherever `python3` does.
It edits the spec as text rather than parsing and re-emitting YAML, which
would flatten the comments that carry most of its documentation — the same
reason `compose_refs.py` rewrites anchors line by line. Values that YAML
would read back as something else are quoted, so an `osVersion` of `22.10`
stays a string instead of becoming the float `22.1`.

What the scripts record is a fallback, not the source of truth: where
node_exporter is running, the map reads the OS from its `node_os_info`
metric instead, which is live and more detailed (`Ubuntu 22.04.5 LTS` rather
than `ubuntu 22.04`). The recorded `os`/`osVersion` cover the bare-metal
servers, which run no exporter, and any stretch where Prometheus is
unreachable.

`collect-os.sh` resolves each VM to a hostname using the spec's own
`config:` block, so no domain is baked into the repo:

```yaml
config:
  domain: us.archive.org
```

Leave it out and the VM ids are used as hostnames directly;
`STACKMAP_DOMAIN` overrides it either way, alongside `STACKMAP_SSH_USER`,
`SSH_OPTS` and `STACKMAP_SPEC_PATH`.

## Keeping `definition:` anchors current

A container's `definition:` links to the exact lines defining its service in
one of openlibrary's compose files
(`.../blob/<sha>/compose.production.yaml#L9-L26`). Only `(compose file,
service name)` is durable there — the line numbers are derived data that go
stale the moment anyone inserts a line above the block.

So `GET /api/spec/definitions` recomputes them, resolving each container to
its service from the container id (`<service>@<vm>`) and the file path
already in the URL, neither of which rots, and returning `{container_id:
url}` for the frontend to overlay onto what the spec already gave it.
Nothing has to be maintained by hand, and the spec file — an input, mounted
read-only — is never written to. The compose files are fetched from GitHub
and cached for an hour (`ComposeCache` in `server/main.py`, warmed at
startup); a container whose service doesn't resolve, or a GitHub that can't
be reached at all, just leaves the spec's own anchor in place, since a link
that's a few lines off beats an endpoint that fails.

This is deliberately a *second* request, made once the map is already on
screen (see `loadDefinitions` in `src/spec.js`), rather than part of
`/api/spec`. The frontend can't render at all until `/api/spec` answers, so
that endpoint does nothing but read the file off disk. Resolving anchors
there instead meant every cold `ComposeCache` — each fresh deploy, and once
per `COMPOSE_RETRY_SECONDS` for as long as GitHub is unreachable — served a
blank page until GitHub replied, which measured ~8s against a source that
times out. Line anchors belong to one right-click menu item; they shouldn't
hold the map hostage.

`server/compose_refs.py` holds that derivation, and doubles as a CLI for
one-off runs and for rewriting the file on disk:

```sh
cd server
uv run python compose_refs.py check     # what's gone stale; exits non-zero if anything has
uv run python compose_refs.py update    # rewrite the anchors in place
uv run python compose_refs.py services  # every service, its line range and its profiles
```

`--ref` is the commit to compute against (default `master`), and `--repo
<path>` reads from a local openlibrary clone instead of GitHub. Rewritten
URLs are pinned to the resolved sha rather than a branch name, since a branch
keeps moving and its line numbers are only right until the next compose edit
— `--no-pin` keeps whatever ref is already there. `update` only ever
rewrites `definition:` lines, and leaves ones it couldn't resolve alone, so a
renamed or removed service gets reported instead of silently mangled.

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

`GET /api/metrics/latest?source=<url>&query=<target>` → latest datapoint (and
a trailing window) for one or more targets. `source` is checked against the
allowlists from `.env`, not the request, rather than proxying anywhere a
caller asks — and it's also what selects the backend: a Graphite source is
fetched from Graphite, a Prometheus one from Prometheus, with the same
response shape either way.

Deciding that here rather than in the frontend is what lets one metric family
be served by both. CPU is: VMs read it from node_exporter via Prometheus,
while the bare-metal servers, which have no node_exporter, stay on collectd
via Graphite.

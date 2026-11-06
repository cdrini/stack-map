"""Metrics API for stack-map: proxies Graphite and Prometheus so the browser
doesn't have to, and serves the stack topology spec itself (see /api/spec) —
neither the spec nor the metrics-source hostnames it contains are ever
committed to the repo, since they name real internal Archive infrastructure.

Graphite's /render endpoint has no Access-Control-Allow-Origin header, so a
direct browser fetch() gets blocked by CORS even though the server itself is
reachable (confirmed via curl). This makes the request server-side instead,
where CORS doesn't apply, and re-exposes it with CORS enabled for the
frontend dev server. Prometheus (used for haproxy metrics) gets the same
treatment, plus a local-dev override — see PROMETHEUS_URL_OVERRIDE below.

Generic over any entity's `metrics: [{ type, source, query }]` in
stack.yaml — the frontend resolves `{{id}}`/`{{disk}}` in `query` itself and
passes the result straight through, so this proxy doesn't need to know about
VMs, metric types, or the templating at all.
"""

import asyncio
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

import compose_refs
from env import get_env

env = get_env()
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warmed in the background rather than awaited, so a slow or unreachable
    # GitHub delays neither startup nor the first request — /api/spec just
    # serves the spec's own anchors until the fetch lands.
    warm = asyncio.create_task(compose_cache.warm())
    yield
    warm.cancel()


app = FastAPI(title="stack-map metrics API", lifespan=lifespan)

# No CORS at all unless STACKMAP_CORS_ALLOWED_ORIGINS is set (see env.py) —
# local dev sets it to "*" itself; production should set it to the deployed
# frontend's real origin instead.
if env.STACKMAP_CORS_ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=env.STACKMAP_CORS_ALLOWED_ORIGINS,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

# `source` comes from stack.yaml (trusted), but is still client-supplied on
# every request — an allowlist keeps this from doubling as an open proxy to
# an arbitrary URL if that ever changed.
ALLOWED_SOURCES = set(env.STACKMAP_GRAPHITE_SOURCES)

PROMETHEUS_SOURCES = {env.STACKMAP_PROMETHEUS_SOURCE}

# stack.yaml always names the real production Prometheus — it's only
# reachable from Archive's internal network, not from a developer's own
# sandbox/laptop. Set this env var to redirect requests there to a local
# tunnel instead (e.g. an SSH port-forward exposed to this process), without
# having to point stack.yaml itself at a URL that wouldn't work in prod:
#   STACKMAP_PROMETHEUS_URL_OVERRIDE=http://host.docker.internal:19090
# Only the request target changes — `source` from the client still has to
# match PROMETHEUS_SOURCES above, so this can't be used to reach anywhere
# else.
PROMETHEUS_URL_OVERRIDE = env.STACKMAP_PROMETHEUS_URL_OVERRIDE

# stack.yaml's `definition:` URLs carry line numbers into openlibrary's
# compose files, and those go stale on their own as the files are edited. They
# get recomputed from the compose files (see compose_refs.py, shared with its
# CLI) rather than written back into the spec: the spec is an input, mounted
# read-only, and derived data doesn't belong in it.
#
# That recomputation is served from its own endpoint rather than folded into
# /api/spec, because it can need a GitHub round trip and /api/spec is what the
# frontend blocks on before it can render anything at all (see main.js). Doing
# both in one response meant a cold cache — every fresh deploy, and once per
# COMPOSE_RETRY_SECONDS whenever GitHub can't be reached — showed a blank page
# until GitHub answered. Line anchors are a detail of one right-click menu
# item; they have no business holding the map hostage.
COMPOSE_REF = "master"
# Anchors only move when someone edits a compose file, so this can be slow.
COMPOSE_TTL_SECONDS = 3600
# Shorter, so a transient GitHub failure isn't served around for a full TTL —
# but still long enough not to retry once per request while it's down.
COMPOSE_RETRY_SECONDS = 300


class ComposeCache:
    """openlibrary's compose files, refetched at most once per TTL.

    Both the sha lookup and the file reads are blocking (compose_refs is a
    sync library, shared with its CLI), so they run in a thread rather than
    on the event loop.
    """

    def __init__(self, ref: str = COMPOSE_REF):
        self.ref = ref
        self._source = compose_refs.GitHubRepo()
        self._files: compose_refs.ComposeFiles | None = None
        self._valid_until = 0.0
        self._lock = asyncio.Lock()

    def _load(self) -> compose_refs.ComposeFiles:
        sha = self._source.resolve(self.ref)
        # An unchanged sha keeps the already-parsed files; a new one starts
        # over, since every anchor in them has potentially moved.
        if self._files is not None and self._files.sha == sha:
            return self._files
        return compose_refs.ComposeFiles(self._source, sha)

    async def get(self) -> compose_refs.ComposeFiles | None:
        """The current compose files, or None if they've never been fetched."""
        if time.monotonic() < self._valid_until:
            return self._files
        async with self._lock:
            # Another request may have refreshed while this one waited.
            if time.monotonic() < self._valid_until:
                return self._files
            try:
                self._files = await asyncio.to_thread(self._load)
                self._valid_until = time.monotonic() + COMPOSE_TTL_SECONDS
            except Exception as e:
                # Never fail /api/spec over this — the spec's own anchors are
                # a usable answer, just possibly a stale one. A previous good
                # fetch keeps being served until it's replaced.
                self._valid_until = time.monotonic() + COMPOSE_RETRY_SECONDS
                log.warning("compose refresh failed, serving spec anchors as-is: %s", e)
        return self._files

    async def warm(self) -> None:
        """Resolve the sha and parse the files the spec points at, so the
        first real request pays for neither. Which files those are is only
        knowable from the spec, hence the throwaway rewrite.
        """
        compose = await self.get()
        if compose is None:
            return
        try:
            await asyncio.to_thread(
                compose_refs.rewrite_definitions,
                env.STACKMAP_SPEC_PATH.read_text(),
                compose,
                compose.sha,
            )
        except Exception as e:
            log.warning("compose warm-up failed: %s", e)


compose_cache = ComposeCache()


# Release and end-of-life dates come from endoflife.date, which is a public
# dataset rather than anything of ours. Cached here instead of in the
# browser so one fetch serves every viewer, and so the page never calls a
# third party itself — the same arrangement ComposeCache has with GitHub,
# for the same reasons.
EOL_API = "https://endoflife.date/api/v1/products"
# A snapshot baked into the image at build time (see the Dockerfile and
# scripts/fetch-os-releases.py). The production hosts have no outbound
# network at all, so this — not the API — is what actually answers there;
# the fetch above is for development, and for any deployment that can reach
# out. Absent in a source checkout, which simply means no fallback.
EOL_SNAPSHOT_PATH = Path(os.environ.get("STACKMAP_OS_RELEASES_PATH", Path(__file__).parent / "os-releases.json"))
# Release dates move when a distro ships a point release or revises an EOL;
# neither is news within a day.
EOL_TTL_SECONDS = 24 * 3600
EOL_RETRY_SECONDS = 600
# Much longer once a snapshot is standing in: a host that can't reach the
# internet won't be able to in ten minutes either, and every retry costs a
# request the full connect timeout.
EOL_OFFLINE_RETRY_SECONDS = 6 * 3600
# A product name goes into a URL path, and it arrives from the client (it's
# whatever `os` the spec records). Anything outside this charset is refused
# rather than escaped, since no real product name needs more.
EOL_PRODUCT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
# All the frontend shows; the rest of each release is noise to it.
EOL_FIELDS = ("name", "label", "codename", "releaseDate", "eolFrom", "ltsFrom", "isLts", "isEol", "isMaintained")


class EolCache:
    """endoflife.date releases per product, refetched at most once per TTL."""

    def __init__(self):
        self._releases: dict[str, list[dict]] = {}
        self._valid_until: dict[str, float] = {}
        self._lock = asyncio.Lock()
        self._snapshot = self._read_snapshot()

    @staticmethod
    def _read_snapshot() -> dict[str, list[dict]]:
        try:
            return json.loads(EOL_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except Exception as e:
            log.warning("could not read %s: %s", EOL_SNAPSHOT_PATH, e)
            return {}

    def _answer(self, product: str) -> list[dict] | None:
        """Live data where we have it, the baked snapshot otherwise.

        Every return path goes through here. When the fallback lived only on
        the path that actually attempts a fetch, the first request after a
        restart was answered and every one after it — for as long as the
        retry window — came back empty, which is the opposite of what a
        cache is for.
        """
        return self._releases.get(product) or self._snapshot.get(product)

    async def get(self, product: str) -> list[dict] | None:
        """That product's releases, or None if nothing knows any."""
        if time.monotonic() < self._valid_until.get(product, 0):
            return self._answer(product)
        async with self._lock:
            if time.monotonic() < self._valid_until.get(product, 0):
                return self._answer(product)
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.get(f"{EOL_API}/{product}/")
                    response.raise_for_status()
                releases = response.json()["result"]["releases"]
                self._releases[product] = [
                    {k: r.get(k) for k in EOL_FIELDS} for r in releases
                ]
                self._valid_until[product] = time.monotonic() + EOL_TTL_SECONDS
            except Exception as e:
                # An unknown product 404s here, which is indistinguishable
                # from a transient failure and treated the same: fall back to
                # the baked snapshot and ask again later.
                offline = product in self._snapshot
                self._valid_until[product] = time.monotonic() + (
                    EOL_OFFLINE_RETRY_SECONDS if offline else EOL_RETRY_SECONDS
                )
                log.warning(
                    "end-of-life lookup failed for %s (%s): %s",
                    product,
                    "serving the baked snapshot" if offline else "no snapshot to fall back on",
                    e,
                )
        return self._answer(product)


eol_cache = EolCache()


# How far back both endpoints below fetch — the map's "rewind" timeline
# (src/RewindTimeline.vue) looks back through this window locally instead
# of firing a fresh request per rewind point (see metrics.js's
# fetchLatestMetric/pickAtTime), so this also caps how far back rewinding
# actually reaches before falling back to the oldest point available.
WINDOW_SECONDS = 600
# Prometheus has no "give me whatever resolution you've got" mode like
# Graphite's /render does — `step` has to be picked explicitly. 15s matches
# the scrape interval this deployment's Prometheus instances actually use;
# revisit if that ever changes (a `step` finer than the real scrape
# interval just wastes a query returning repeated values).
PROMETHEUS_STEP_SECONDS = 15

# Routes live on a router rather than `app` directly so STACKMAP_BASE_PATH
# (e.g. "/stack-map", for an nginx location block that forwards the full
# path through unchanged rather than stripping its prefix) can prefix all
# of them at once — empty by default, meaning served from the domain root.
router = APIRouter()


@router.get("/api/spec", response_class=PlainTextResponse)
async def spec():
    """The stack topology, as raw YAML — the frontend parses it itself (it
    already depends on js-yaml). Read fresh on every request rather than
    cached at startup, so editing STACKMAP_SPEC_PATH's file takes effect on
    the next browser refresh instead of a server restart.

    Deliberately does nothing but read the file: the frontend can't render
    until this returns, so it must never wait on anything remote. The
    `definition:` anchors in it are whatever the file says, which may be a
    few lines stale; /api/spec/definitions below refreshes them afterwards.
    """
    return env.STACKMAP_SPEC_PATH.read_text()


@router.get("/api/spec/definitions")
async def spec_definitions():
    """Each container's `definition:` URL, recomputed against openlibrary's
    compose files — `{container_id: url}`, for the frontend to overlay onto
    the anchors /api/spec already gave it.

    Free to be slow: it's fetched in the background once the map is already
    on screen (see spec.js's loadDefinitions), so a cold ComposeCache paying
    for a GitHub round trip here costs nobody a blank page. Containers whose
    service can't be resolved are left out rather than guessed at, so the
    spec's own anchor stays in use for them; likewise an unreachable GitHub
    returns an empty object rather than an error, since the anchors already
    in hand are a perfectly good answer.
    """
    compose = await compose_cache.get()
    if compose is None:
        return {}
    text = env.STACKMAP_SPEC_PATH.read_text()
    try:
        definitions = await asyncio.to_thread(
            compose_refs.read_definitions, text, compose, compose.sha
        )
    except Exception as e:
        log.warning("could not resolve definition anchors: %s", e)
        return {}
    return {d.container: d.url for d in definitions if d.block is not None}


@router.get("/api/os-releases")
async def os_releases(product: list[str] = Query(...)):
    """Release and end-of-life dates for one or more OS products, keyed by
    product — e.g. GET /api/os-releases?product=debian&product=ubuntu.

    The frontend asks for the distinct `os` values its VMs record, which is
    a handful however large the fleet is, since the data is per product
    rather than per version. A product with nothing to say maps to `null`
    rather than failing the request, the same way an unresolvable Graphite
    target does.
    """
    result = {}
    for name in product:
        if not EOL_PRODUCT_RE.match(name):
            raise HTTPException(status_code=400, detail=f"not a product name: {name}")
        result[name] = await eol_cache.get(name)
    return result


@router.get("/api/metrics/latest")
async def metrics_latest(source: str, query: list[str] = Query(...)):
    """Latest datapoint (plus a trailing window — see WINDOW_SECONDS) for one
    or more metrics — e.g. GET /api/metrics/latest?source=<src>&query=a&query=b.

    Which backend answers is decided here, from `source`, rather than by the
    caller picking an endpoint: the source is the only thing that actually
    knows. That matters now that a metric family can be served by either one
    — CPU comes from node_exporter for VMs and from collectd for the
    bare-metal servers — so the backend can't be inferred from a metric's
    type, and the frontend is better off not trying.

    Always returns an object keyed by query, `{query: {value, timestamp,
    window}}`, even for a single query — the frontend's batching layer
    (metrics.js) is the only caller and always wants that shape. `value`/
    `timestamp` are the window's own latest point, kept as top-level
    fields so today's callers (which only want "the current value") don't
    need to reach into `window` at all. A query with no data (metric
    doesn't exist, or genuinely has none) maps to `null` rather than
    failing the whole request — Graphite itself does this: an unresolvable
    target is just silently absent from its response, not an error, so
    partial results are the normal case here, not a fallback.
    """
    if source in PROMETHEUS_SOURCES:
        return await _fetch_prometheus(source, query)
    if source not in ALLOWED_SOURCES:
        raise HTTPException(status_code=400, detail=f"source not allowed: {source}")

    params = [("target", q) for q in query] + [("from", f"-{WINDOW_SECONDS}s"), ("format", "json")]
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(source, params=params)
            response.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"metrics source request failed: {e}")

    by_target = {series["target"]: series for series in response.json()}

    result = {}
    for q in query:
        series = by_target.get(q)
        datapoints = series["datapoints"] if series else []
        window = [{"value": value, "timestamp": timestamp} for value, timestamp in datapoints if value is not None]
        latest = window[-1] if window else None
        result[q] = {"value": latest["value"], "timestamp": latest["timestamp"], "window": window} if latest else None

    return result


async def _fetch_prometheus_one(client: httpx.AsyncClient, base: str, query: str):
    now = time.time()
    try:
        response = await client.get(
            f"{base}/api/v1/query_range",
            params={
                "query": query,
                "start": now - WINDOW_SECONDS,
                "end": now,
                "step": f"{PROMETHEUS_STEP_SECONDS}s",
            },
        )
        response.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"metrics source request failed: {e}")

    series = response.json()["data"]["result"]
    if not series:
        return query, None
    window = [{"value": float(value), "timestamp": timestamp} for timestamp, value in series[0]["values"]]
    latest = window[-1] if window else None
    if not latest:
        return query, None
    # Prometheus "info" metrics carry their payload in labels and leave the
    # value as a constant 1 — node_os_info is the whole OS release in label
    # form. Passing them through costs little and is the only way the
    # frontend can read one.
    labels = {k: v for k, v in series[0].get("metric", {}).items() if k != "__name__"}
    return query, {
        "value": latest["value"],
        "timestamp": latest["timestamp"],
        "window": window,
        "labels": labels,
    }


async def _fetch_prometheus(source: str, query: list[str]):
    """Same contract as the Graphite half above (including the `window` field
    — see WINDOW_SECONDS), but one request per query, fired concurrently so an
    N-query batch still costs one round trip's worth of wall-clock time rather
    than N sequential ones. Uses the range-query API rather than an instant
    query, which by construction can't return a window at all.
    """
    base = PROMETHEUS_URL_OVERRIDE or source
    async with httpx.AsyncClient(timeout=10.0) as client:
        results = await asyncio.gather(*(_fetch_prometheus_one(client, base, q) for q in query))

    return dict(results)


app.include_router(router, prefix=env.STACKMAP_BASE_PATH)

# The Docker image builds the frontend into ./static (see the repo root
# Dockerfile, which also bakes STACKMAP_BASE_PATH into the built asset URLs
# via vite's `base` — the two must agree) so the whole app — API and UI —
# is served from this one process; a bare `uv run uvicorn main:app` for
# local dev has no static/ dir, so this is skipped and the frontend runs
# separately via `npm run dev`. Mounted last so it only catches requests
# the routes above didn't.
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.is_dir():
    app.mount(env.STACKMAP_BASE_PATH or "/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

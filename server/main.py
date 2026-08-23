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
from pathlib import Path

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from env import get_env

env = get_env()

app = FastAPI(title="stack-map metrics API")

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
ALLOWED_SOURCES = {env.STACKMAP_GRAPHITE_SOURCE}

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
    """
    return env.STACKMAP_SPEC_PATH.read_text()


@router.get("/api/metrics/latest")
async def metrics_latest(source: str, query: list[str] = Query(...)):
    """Latest datapoint for one or more metrics in a single Graphite round
    trip (Graphite's /render accepts repeated `target` params natively) —
    e.g. GET /api/metrics/latest?source=http://graphite.../render&query=a&query=b.

    Always returns an object keyed by query, `{query: {value, timestamp}}`,
    even for a single query — the frontend's batching layer (metrics.js)
    is the only caller and always wants that shape. A query with no data
    (metric doesn't exist, or genuinely has none) maps to `null` rather
    than failing the whole request — Graphite itself does this: an
    unresolvable target is just silently absent from its response, not an
    error, so partial results are the normal case here, not a fallback.
    """
    if source not in ALLOWED_SOURCES:
        raise HTTPException(status_code=400, detail=f"source not allowed: {source}")

    params = [("target", q) for q in query] + [("from", "-5min"), ("format", "json")]
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
        latest = next((dp for dp in reversed(datapoints) if dp[0] is not None), None)
        result[q] = {"value": latest[0], "timestamp": latest[1]} if latest else None

    return result


async def _fetch_prometheus_one(client: httpx.AsyncClient, base: str, query: str):
    try:
        response = await client.get(f"{base}/api/v1/query", params={"query": query})
        response.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"metrics source request failed: {e}")

    series = response.json()["data"]["result"]
    if not series:
        return query, None
    timestamp, value = series[0]["value"]
    return query, {"value": float(value), "timestamp": timestamp}


@router.get("/api/metrics/prometheus/latest")
async def prometheus_metrics_latest(source: str, query: list[str] = Query(...)):
    """Same contract as /api/metrics/latest, but for Prometheus's instant
    query API — one request per query (Prometheus has no equivalent of
    Graphite's repeated-target batching), fired concurrently so an N-query
    batch still costs one round trip's worth of wall-clock time rather than
    N sequential ones.
    """
    if source not in PROMETHEUS_SOURCES:
        raise HTTPException(status_code=400, detail=f"source not allowed: {source}")

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

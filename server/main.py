"""Metrics API for stack-map: proxies Graphite so the browser doesn't have to.

Graphite's /render endpoint has no Access-Control-Allow-Origin header, so a
direct browser fetch() gets blocked by CORS even though the server itself is
reachable (confirmed via curl). This makes the request server-side instead,
where CORS doesn't apply, and re-exposes it with CORS enabled for the
frontend dev server.

Generic over any entity's `metrics: [{ type, source, query }]` in
stack.yaml — the frontend resolves `{{id}}` in `query` itself and passes the
result straight through, so this proxy doesn't need to know about VMs,
metric types, or the templating at all.
"""

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="stack-map metrics API")

# Permissive for now — this is a local dev tool with no auth of its own,
# not something exposed beyond a developer's machine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# `source` comes from stack.yaml (trusted), but is still client-supplied on
# every request — an allowlist keeps this from doubling as an open proxy to
# an arbitrary URL if that ever changed.
ALLOWED_SOURCES = {"http://graphite0-web.us.archive.org/render"}


@app.get("/api/metrics/latest")
async def metrics_latest(source: str, query: str):
    """Latest datapoint for one metric, e.g.
    GET /api/metrics/latest?source=http://graphite.../render&query=collectd.foo.load
    """
    if source not in ALLOWED_SOURCES:
        raise HTTPException(status_code=400, detail=f"source not allowed: {source}")

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(
                source, params={"target": query, "from": "-5min", "format": "json"}
            )
            response.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"metrics source request failed: {e}")

    series = response.json()
    datapoints = series[0]["datapoints"] if series else []
    latest = next((dp for dp in reversed(datapoints) if dp[0] is not None), None)
    if latest is None:
        raise HTTPException(status_code=404, detail=f"no data for {query}")

    value, timestamp = latest
    return {"query": query, "value": value, "timestamp": timestamp}

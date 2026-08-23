# syntax=docker/dockerfile:1

# ---- Build the static frontend ----
# Only this stage needs node/npm/node_modules — none of that ships in the
# final image, just the static files vite produces in dist/.
FROM node:22-alpine AS frontend-builder
# Where this app is actually served from — "/" for the domain root, or e.g.
# "/stack-map/" behind an nginx location that forwards the full path through
# unchanged rather than stripping it. Must match STACKMAP_BASE_PATH at
# runtime (see server/env.py), since that's what the API routes use.
ARG BASE_PATH=/
# A private registry mirror (e.g. an internal Nexus), for hosts that can't
# reach the public registry directly — empty (the default) uses npm's own
# default registry. npm reads this env var itself; no --registry flag needed.
ARG NPM_CONFIG_REGISTRY
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build -- --base="$BASE_PATH"

# ---- API server, also serving the built frontend ----
FROM python:3.14-slim AS runtime
# Same idea as NPM_CONFIG_REGISTRY above, for pip and uv — both read these
# env vars natively, so no --index-url flag is needed on the RUN commands
# below. Empty (the default) uses PyPI directly.
ARG PIP_INDEX_URL
ARG UV_DEFAULT_INDEX=$PIP_INDEX_URL
# uv from PyPI rather than ghcr.io's own image — a plain `pip install` also
# works for a host that only has registry access to PyPI/Docker Hub, not ghcr.io.
RUN pip install --no-cache-dir uv
WORKDIR /app

# Dependency layer first so it's cached across source-only changes.
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen

COPY server/env.py server/main.py ./
COPY --from=frontend-builder /app/dist ./static

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

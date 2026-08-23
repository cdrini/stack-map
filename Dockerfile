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
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build -- --base="$BASE_PATH"

# ---- Resolve the venv ----
# uv is only ever needed to build the venv below, never at runtime — kept
# in its own stage so its own (surprisingly large — the PyPI package bundles
# a full Rust binary) install cost never ends up in the shipped image.
FROM python:3.14-alpine AS deps-builder
# uv from PyPI rather than ghcr.io's own image — a plain `pip install` also
# works for a host that only has registry access to PyPI/Docker Hub, not ghcr.io.
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen

# ---- API server, also serving the built frontend ----
FROM python:3.14-alpine AS runtime
WORKDIR /app
COPY --from=deps-builder /app/.venv ./.venv
COPY server/env.py server/main.py ./
COPY --from=frontend-builder /app/dist ./static

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

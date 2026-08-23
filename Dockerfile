# syntax=docker/dockerfile:1

# ---- Build the static frontend ----
# Only this stage needs node/npm/node_modules — none of that ships in the
# final image, just the static files vite produces in dist/.
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---- API server, also serving the built frontend ----
FROM python:3.14-slim AS runtime
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

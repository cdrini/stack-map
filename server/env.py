"""Typed access to this server's environment variables — modeled on
openlibrary's own `core/env.py`. The real metrics-source hostnames name
internal Archive infrastructure, so they're never hardcoded in source, only
ever read here (backed by a git-ignored .env; see .env.example for the
expected names).
"""

import os
from functools import cached_property
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Local dev's own copy, one level up from this file — see .gitignore.
# Deployments (e.g. the Docker image, which never gets this file baked in)
# override STACKMAP_SPEC_PATH to wherever it's actually mounted instead.
DEFAULT_SPEC_PATH = Path(__file__).parent.parent / "src" / "stack.yaml"


class Env:
    def _required(self, name: str) -> str:
        value = os.environ.get(name)
        if not value:
            raise RuntimeError(f"{name} must be set — copy server/.env.example to server/.env and fill it in")
        return value

    # The spec itself names real internal infrastructure (server/VM/container
    # topology), so — like the metrics-source hostnames below — it's never
    # committed, only ever read from disk here, at a path that's overridable
    # per-deployment rather than fixed to local dev's own layout.
    @cached_property
    def STACKMAP_SPEC_PATH(self) -> Path:
        raw = os.environ.get("STACKMAP_SPEC_PATH")
        path = Path(raw) if raw else DEFAULT_SPEC_PATH
        if not path.is_file():
            raise RuntimeError(f"STACKMAP_SPEC_PATH does not exist: {path}")
        return path

    # Empty by default — served from the domain root. Set this when a
    # reverse proxy forwards a location's full path through unchanged
    # instead of stripping it (e.g. an nginx `location /stack-map { ...
    # proxy_pass ...; }` block with no trailing slash on proxy_pass) — must
    # match the BASE_PATH build arg the Docker image was built with, since
    # that's what controls the built frontend's own asset URLs.
    @cached_property
    def STACKMAP_BASE_PATH(self) -> str:
        return os.environ.get("STACKMAP_BASE_PATH", "").rstrip("/")

    # Comma-separated if metrics are ever split across more than one Graphite
    # instance (stack.yaml metrics each name their own `source:` exactly —
    # this is just the allowlist main.py checks that against). A single
    # value with no comma still works exactly as before.
    @cached_property
    def STACKMAP_GRAPHITE_SOURCES(self) -> list[str]:
        raw = self._required("STACKMAP_GRAPHITE_SOURCE")
        return [source.strip() for source in raw.split(",") if source.strip()]

    @cached_property
    def STACKMAP_PROMETHEUS_SOURCE(self) -> str:
        return self._required("STACKMAP_PROMETHEUS_SOURCE")

    # Optional — see the comment above where this is used in main.py.
    @cached_property
    def STACKMAP_PROMETHEUS_URL_OVERRIDE(self) -> str | None:
        return os.environ.get("STACKMAP_PROMETHEUS_URL_OVERRIDE") or None

    # Empty by default — no CORS headers at all, so cross-origin requests
    # are blocked by the browser's normal same-origin policy, until
    # something explicitly opts in. Local dev opts in on purpose (see
    # .env.example) rather than this defaulting to "*" itself, so a
    # production deployment that forgets to set this fails closed instead
    # of silently wide open. Comma-separated if the frontend's ever served
    # from more than one origin.
    @cached_property
    def STACKMAP_CORS_ALLOWED_ORIGINS(self) -> list[str]:
        raw = os.environ.get("STACKMAP_CORS_ALLOWED_ORIGINS")
        if not raw:
            return []
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


_env = Env()


def get_env() -> Env:
    return _env

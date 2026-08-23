"""Typed access to this server's environment variables — modeled on
openlibrary's own `core/env.py`. The real metrics-source hostnames name
internal Archive infrastructure, so they're never hardcoded in source, only
ever read here (backed by a git-ignored .env; see .env.example for the
expected names).
"""

import os
from functools import cached_property

from dotenv import load_dotenv

load_dotenv()


class Env:
    def _required(self, name: str) -> str:
        value = os.environ.get(name)
        if not value:
            raise RuntimeError(f"{name} must be set — copy server/.env.example to server/.env and fill it in")
        return value

    @cached_property
    def STACKMAP_GRAPHITE_SOURCE(self) -> str:
        return self._required("STACKMAP_GRAPHITE_SOURCE")

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

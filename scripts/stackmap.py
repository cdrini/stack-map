#!/usr/bin/env python3
"""Read and edit stack.yaml, for scripts that collect facts about the stack.

The spec is the input the whole map is drawn from, and most of what it
explains it explains in comments — so this edits it as text, line by line,
rather than parsing and re-emitting YAML, which would flatten every one of
them. `server/compose_refs.py` rewrites the `definition:` anchors the same
way and for the same reason.

Only the standard library, so it runs wherever python3 does — no venv, no
pip install. It is deliberately dumb about YAML: entities are `  - id: <id>`
lines under a top-level section, and fields are `    <key>: <value>` lines
beneath them, which is how the spec is written throughout.

Usage:

    stackmap.py config domain              # a value from the spec's config block
    stackmap.py vms                        # every VM id, one per line
    stackmap.py get ol-web0                # that entity's scalar fields
    stackmap.py get ol-web0 ip             # just one
    stackmap.py set ol-web0 os=ubuntu osVersion=22.04
    stackmap.py set ol-web0 os=ubuntu --dry-run

`--spec PATH` (or $STACKMAP_SPEC_PATH) chooses the file; it defaults to
../src/stack.yaml relative to this script, matching server/env.py.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

DEFAULT_SPEC = Path(__file__).resolve().parent.parent / "src" / "stack.yaml"

SECTIONS = ("servers", "vms", "containers", "externals")

ENTITY_RE = re.compile(r"^  - id: (?P<id>\S+)\s*$")
# A field with its value on the same line. `relationships:`/`metrics:` open a
# nested block instead and have nothing after the colon, so they don't match.
FIELD_RE = re.compile(r"^    (?P<key>[A-Za-z_][\w-]*): (?P<value>.+?)\s*$")
BLOCK_OPEN_RE = re.compile(r"^    (?P<key>[A-Za-z_][\w-]*):\s*$")
SECTION_RE = re.compile(r"^(?P<name>[A-Za-z_][\w-]*):\s*$")


# The spec is UTF-8 — em dashes, arrows, an emoji — and Windows would
# otherwise decode it as cp1252 and fail. `newline=""` keeps whatever line
# endings the file has instead of translating them on the way in or out,
# so a CRLF checkout doesn't come back rewritten end to end.
def read_spec(path: Path) -> list[str]:
    with path.open(encoding="utf-8", newline="") as f:
        return f.read().splitlines(keepends=True)


def write_spec(path: Path, lines: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write("".join(lines))


def line_ending(lines: list[str]) -> str:
    """Whatever this file already uses, so an inserted line matches."""
    for line in lines:
        if line.endswith("\r\n"):
            return "\r\n"
        if line.endswith("\n"):
            return "\n"
    return "\n"


def section_bounds(lines: list[str], name: str) -> tuple[int, int]:
    """Half-open line range of one top-level section's body."""
    start = None
    for i, line in enumerate(lines):
        match = SECTION_RE.match(line)
        if match and match.group("name") == name:
            start = i + 1
            break
    if start is None:
        raise KeyError(f"no `{name}:` section in the spec")
    for i in range(start, len(lines)):
        if SECTION_RE.match(lines[i]):
            return start, i
    return start, len(lines)


# A top-level mapping rather than a list of entities, so its fields sit one
# indent in: `config:` / `  domain: ...`.
CONFIG_RE = re.compile(r"^  (?P<key>[A-Za-z_][\w-]*): (?P<value>.+?)\s*$")


def config(lines: list[str]) -> dict[str, str]:
    """The spec's own `config:` block, or empty if it has none."""
    try:
        start, end = section_bounds(lines, "config")
    except KeyError:
        return {}
    found = {}
    for line in lines[start:end]:
        match = CONFIG_RE.match(line)
        if match:
            found[match.group("key")] = match.group("value").strip('"')
    return found


def entity_ids(lines: list[str], section: str) -> list[str]:
    start, end = section_bounds(lines, section)
    return [m.group("id") for m in (ENTITY_RE.match(l) for l in lines[start:end]) if m]


def entity_bounds(lines: list[str], entity_id: str) -> tuple[int, int]:
    """Half-open line range of one entity's block, searched across sections."""
    for section in SECTIONS:
        try:
            start, end = section_bounds(lines, section)
        except KeyError:
            continue
        for i in range(start, end):
            match = ENTITY_RE.match(lines[i])
            if not match or match.group("id") != entity_id:
                continue
            for j in range(i + 1, end):
                if ENTITY_RE.match(lines[j]) or SECTION_RE.match(lines[j]):
                    return i, j
            return i, end
    raise KeyError(f"no entity with id {entity_id!r}")


def fields(lines: list[str], entity_id: str) -> dict[str, str]:
    """The entity's scalar fields. Nested blocks are not scalars and are
    deliberately left out — nothing here needs to read them."""
    start, end = entity_bounds(lines, entity_id)
    found = {}
    for line in lines[start + 1 : end]:
        match = FIELD_RE.match(line)
        if match:
            found[match.group("key")] = match.group("value")
    return found


# Values YAML would read back as something other than the string given.
# Versions are the reason this matters: an unquoted 22.10 is the float 22.1,
# and the spec would quietly lose the trailing zero.
NUMERIC_RE = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")
NOT_A_STRING = {"true", "false", "yes", "no", "on", "off", "null", "none", "~"}


def quote(value: str) -> str:
    """A plain scalar where that reads back unchanged, quoted where it wouldn't."""
    if value == "":
        return '""'
    risky = (
        value[0] in "-?:,[]{}#&*!|>'\"%@`"
        or ": " in value
        or value.endswith(":")
        or value.strip() != value
        or NUMERIC_RE.match(value)
        or value.lower() in NOT_A_STRING
    )
    if risky:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return value


def set_fields(lines: list[str], entity_id: str, updates: dict[str, str]) -> tuple[list[str], list[str]]:
    """Set or add scalar fields on one entity. Returns the new lines and a
    description of what changed, so callers can report it."""
    start, end = entity_bounds(lines, entity_id)
    out = list(lines)
    changes = []
    ending = line_ending(lines)

    for key, value in updates.items():
        start, end = entity_bounds(out, entity_id)  # bounds shift as we insert
        line = f"    {key}: {quote(value)}{ending}"
        existing = None
        # Where a new field goes: after the last scalar, but ahead of any
        # nested block, so `relationships:` and friends stay at the bottom
        # of the entity where they're written.
        insert_at = start + 1
        for i in range(start + 1, end):
            match = FIELD_RE.match(out[i])
            if match and match.group("key") == key:
                existing = i
                break
            if BLOCK_OPEN_RE.match(out[i]):
                break
            if match:
                insert_at = i + 1

        if existing is not None:
            was = FIELD_RE.match(out[existing]).group("value")
            if was == quote(value):
                continue
            out[existing] = line
            changes.append(f"{key}: {was} -> {value}")
        else:
            out.insert(insert_at, line)
            changes.append(f"{key}: {value} (new)")

    return out, changes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--spec",
        type=Path,
        default=Path(os.environ.get("STACKMAP_SPEC_PATH", DEFAULT_SPEC)),
        help="path to stack.yaml (default: $STACKMAP_SPEC_PATH, else ../src/stack.yaml)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    ids = sub.add_parser("vms", help="every VM id, one per line")
    ids.add_argument("--section", default="vms", choices=SECTIONS, help="list a different section instead")

    conf = sub.add_parser("config", help="the spec's own config block")
    conf.add_argument("key", nargs="?")

    get = sub.add_parser("get", help="an entity's scalar fields")
    get.add_argument("id")
    get.add_argument("field", nargs="?")

    put = sub.add_parser("set", help="set scalar fields on an entity")
    put.add_argument("id")
    put.add_argument("assignments", nargs="+", metavar="key=value")
    put.add_argument("--dry-run", action="store_true", help="report the change without writing")

    args = parser.parse_args(argv)
    if not args.spec.is_file():
        print(f"stackmap: no spec at {args.spec}", file=sys.stderr)
        return 2
    lines = read_spec(args.spec)

    if args.command == "config":
        found = config(lines)
        if args.key:
            if args.key not in found:
                return 1
            print(found[args.key])
        else:
            for key, value in found.items():
                print(f"{key}={value}")
        return 0

    if args.command == "vms":
        for entity_id in entity_ids(lines, args.section):
            print(entity_id)
        return 0

    try:
        if args.command == "get":
            found = fields(lines, args.id)
            if args.field:
                if args.field not in found:
                    return 1
                print(found[args.field])
            else:
                for key, value in found.items():
                    print(f"{key}={value}")
            return 0

        updates = {}
        for assignment in args.assignments:
            if "=" not in assignment:
                print(f"stackmap: expected key=value, got {assignment!r}", file=sys.stderr)
                return 2
            key, value = assignment.split("=", 1)
            updates[key] = value

        out, changes = set_fields(lines, args.id, updates)
        if not changes:
            print(f"{args.id}: already up to date")
            return 0
        if args.dry_run:
            print(f"{args.id}: would set {', '.join(changes)}")
            return 0
        write_spec(args.spec, out)
        print(f"{args.id}: {', '.join(changes)}")
        return 0
    except KeyError as e:
        print(f"stackmap: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

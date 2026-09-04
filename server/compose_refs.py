"""Recompute the spec's `definition:` line anchors from openlibrary's compose
files, at any git sha.

A container's `definition:` URL points at the exact block of lines defining
its service (e.g. `.../blob/master/compose.production.yaml#L9-L23`). Only
`(compose file, service name)` is durable there — the line numbers are
derived data that go stale the moment anyone inserts a line above the block,
so they're recomputed from the compose file rather than maintained by hand.

The spec stores no service name, but one is recoverable: a container id is
`<service>@<vm>`, and the file path in the existing URL doesn't rot (only the
`#L..-L..` anchor does). See `candidate_services` for the one id shape that
needs more than that.

Rewritten URLs are pinned to the resolved sha rather than a branch name, since
a branch keeps moving and its line numbers are only right until the next
compose edit — pass `--no-pin` to keep whatever ref the URL already names.

Compose files are read from a local openlibrary clone when `--repo` names one
(no network, but only for shas it has fetched), otherwise from GitHub's raw
endpoint (any sha, and no clone needed — which is what a deployment has).

`main.py` uses `rewrite_definitions` to do this on the way out of
`GET /api/spec`, so the served spec's anchors are current without the file on
disk ever being written to; this CLI is for one-off runs and for actually
updating the file.

Usage, from this directory:

    uv run python compose_refs.py services --ref master
    uv run python compose_refs.py check --ref master
    uv run python compose_refs.py update --ref master
"""

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

DEFAULT_GITHUB_REPO = "internetarchive/openlibrary"

# A `definition:` is always a GitHub blob URL into a compose file, with a line
# anchor. The anchor is reparsed only to report what it used to say; it's
# always recomputed, never trusted.
DEFINITION_RE = re.compile(
    r"^(?P<indent>\s*)definition: https://github\.com/"
    r"(?P<repo>[^/\s]+/[^/\s]+)/blob/(?P<ref>[^/\s]+)/"
    r"(?P<path>[^#\s]+)#L(?P<start>\d+)(?:-L(?P<end>\d+))?\s*$"
)
CONTAINER_ID_RE = re.compile(r"^\s*-\s+id:\s*(?P<id>\S+)\s*$")

# Indent-0 mapping key — the boundary a service block can end on besides the
# next service key (e.g. staging's `memcached:` is followed by top-level
# `volumes:`, not by another service).
TOP_LEVEL_KEY_RE = re.compile(r"^(?P<name>[A-Za-z_][\w.-]*):")


@dataclass(frozen=True)
class ServiceBlock:
    """One service's line range in a compose file, 1-based and inclusive."""

    name: str
    start: int
    end: int
    profiles: tuple[str, ...]

    @property
    def anchor(self) -> str:
        return f"L{self.start}-L{self.end}"


def _blank_or_comment(line: str) -> bool:
    stripped = line.strip()
    return not stripped or stripped.startswith("#")


def _top_level_body(lines: list[str], key: str) -> tuple[int, int] | None:
    """Half-open 0-based line range of a top-level block's body."""
    for i, line in enumerate(lines):
        match = TOP_LEVEL_KEY_RE.match(line)
        if not match or match.group("name") != key:
            continue
        for j in range(i + 1, len(lines)):
            if TOP_LEVEL_KEY_RE.match(lines[j]):
                return i + 1, j
        return i + 1, len(lines)
    return None


def parse_services(text: str) -> dict[str, ServiceBlock]:
    """Every service in a compose file, keyed by name.

    Line-oriented on purpose: the ranges follow the convention the
    hand-written anchors already use, which includes a block's own comments
    but stops before the blank/comment lines that introduce the next service
    — something YAML node marks can't express. Safe against being fooled by
    string content, since a block scalar's lines are always indented deeper
    than the service key they hang off.
    """
    lines = text.splitlines()
    body = _top_level_body(lines, "services")
    if body is None:
        raise ValueError("no top-level `services:` key")
    body_start, body_end = body

    indents = [
        len(line) - len(line.lstrip())
        for line in lines[body_start:body_end]
        if not _blank_or_comment(line)
    ]
    if not indents:
        return {}
    key_re = re.compile(rf"^ {{{min(indents)}}}(?P<name>[\w.-]+):\s*(?:#.*)?$")

    keys = [
        (i, match.group("name"))
        for i in range(body_start, body_end)
        if (match := key_re.match(lines[i]))
    ]

    blocks: dict[str, ServiceBlock] = {}
    for n, (start, name) in enumerate(keys):
        stop = keys[n + 1][0] if n + 1 < len(keys) else body_end
        end = stop - 1
        while end > start and _blank_or_comment(lines[end]):
            end -= 1
        blocks[name] = ServiceBlock(
            name=name,
            start=start + 1,
            end=end + 1,
            profiles=_profiles(lines, start, stop),
        )
    return blocks


def _profiles(lines: list[str], start: int, stop: int) -> tuple[str, ...]:
    """A service's `profiles:` list, which is what pins it to its VM(s)."""
    for line in lines[start:stop]:
        match = re.match(r"^\s+profiles:\s*\[(?P<items>.*)\]\s*$", line)
        if match:
            return tuple(re.findall(r"""['"]?([\w.-]+)['"]?""", match.group("items")))
    return ()


def candidate_services(container_id: str) -> list[str]:
    """Service-name candidates for a container id, best first.

    Ids are `<service>@<vm>`, except where the same service name appears in
    more than one compose file and the id carries a disambiguating prefix
    (`solr_builder-solr_prod@ol-solr1` → `solr_prod`). Stripping is only ever
    a fallback, so ids whose service name legitimately contains a hyphen
    (`cron-jobs`, `solr-next-updater`) match before it is reached.
    """
    name = container_id.split("@", 1)[0]
    candidates = [name]
    while "-" in name:
        name = name.split("-", 1)[1]
        candidates.append(name)
    return candidates


class LocalRepo:
    """Compose files out of a clone, for shas it has already fetched."""

    def __init__(self, path: Path):
        self.path = path

    def __str__(self) -> str:
        return str(self.path)

    def _git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(self.path), *args],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"git {' '.join(args)}: {result.stderr.strip()}")
        return result.stdout

    def resolve(self, ref: str) -> str:
        sha = self._git("rev-parse", f"{ref}^{{commit}}").strip()
        # A local branch that hasn't been fetched in a while resolves fine and
        # silently yields line numbers for an older file — the exact failure
        # this script exists to catch, so it's worth a word.
        try:
            tracking = self._git("rev-parse", f"origin/{ref}^{{commit}}").strip()
        except RuntimeError:
            return sha
        if tracking != sha:
            print(
                f"warning: {self.path}'s {ref} ({sha[:9]}) is behind "
                f"origin/{ref} ({tracking[:9]}) — `git fetch`, or pass "
                f"--ref origin/{ref}",
                file=sys.stderr,
            )
        return sha

    def describe(self, sha: str) -> str:
        return self._git("log", "-1", "--format=%ci", sha).strip()

    def read(self, sha: str, path: str) -> str:
        return self._git("show", f"{sha}:{path}")


class GitHubRepo:
    """Compose files straight off GitHub — any sha, no clone required."""

    def __init__(self, repo: str = DEFAULT_GITHUB_REPO):
        self.repo = repo

    def __str__(self) -> str:
        return f"github:{self.repo}"

    def resolve(self, ref: str) -> str:
        response = httpx.get(
            f"https://api.github.com/repos/{self.repo}/commits/{ref}",
            headers={"Accept": "application/vnd.github+json"},
            timeout=30,
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.json()["sha"]

    def describe(self, sha: str) -> str:
        response = httpx.get(
            f"https://api.github.com/repos/{self.repo}/commits/{sha}",
            headers={"Accept": "application/vnd.github+json"},
            timeout=30,
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.json()["commit"]["committer"]["date"]

    def read(self, sha: str, path: str) -> str:
        response = httpx.get(
            f"https://raw.githubusercontent.com/{self.repo}/{sha}/{path}",
            timeout=30,
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.text


class ComposeFiles:
    """Services per compose file at one sha, read at most once each."""

    def __init__(self, source: LocalRepo | GitHubRepo, sha: str):
        self.source = source
        self.sha = sha
        self._cache: dict[str, dict[str, ServiceBlock]] = {}

    @property
    def paths(self) -> list[str]:
        """Compose files read so far."""
        return sorted(self._cache)

    def services(self, path: str) -> dict[str, ServiceBlock]:
        if path not in self._cache:
            self._cache[path] = parse_services(self.source.read(self.sha, path))
        return self._cache[path]


@dataclass(frozen=True)
class Definition:
    """One `definition:` line in the spec, and what it should now say."""

    line_no: int  # 1-based, into the spec file
    container: str
    repo: str
    ref: str
    path: str
    old_anchor: str
    block: ServiceBlock | None
    # The ref the URL should name, or None to leave whatever it already says.
    target_ref: str | None

    @property
    def status(self) -> str:
        if self.block is None:
            return "unresolved"
        if self.block.anchor != self.old_anchor:
            return "drift"
        # Anchor still lands on the right lines, but names a different commit
        # than the one it was just verified against.
        if self.target_ref and self.target_ref != self.ref:
            return "repin"
        return "ok"

    @property
    def url(self) -> str:
        anchor = self.block.anchor if self.block else self.old_anchor
        ref = self.target_ref or self.ref
        return f"https://github.com/{self.repo}/blob/{ref}/{self.path}#{anchor}"


def read_definitions(
    spec_text: str, compose: ComposeFiles, target_ref: str | None = None
) -> list[Definition]:
    """Every `definition:` in the spec, resolved against the compose files.

    The spec is walked as text rather than parsed as YAML — `update` rewrites
    it in place and a YAML round-trip would flatten the comments that carry
    most of its documentation.
    """
    container = ""
    definitions = []
    for i, line in enumerate(spec_text.splitlines(), start=1):
        if match := CONTAINER_ID_RE.match(line):
            container = match.group("id")
            continue
        if not (match := DEFINITION_RE.match(line)):
            continue
        path = match.group("path")
        services = compose.services(path)
        block = next(
            (services[name] for name in candidate_services(container) if name in services),
            None,
        )
        end = match.group("end") or match.group("start")
        definitions.append(
            Definition(
                line_no=i,
                container=container,
                repo=match.group("repo"),
                ref=match.group("ref"),
                path=path,
                old_anchor=f"L{match.group('start')}-L{end}",
                block=block,
                target_ref=target_ref,
            )
        )
    return definitions


def rewrite_definitions(
    spec_text: str, compose: ComposeFiles, target_ref: str | None = None
) -> tuple[str, list[Definition]]:
    """The spec with every resolvable `definition:` anchor recomputed.

    Only `definition:` lines are rewritten, so the comments carrying most of
    the spec's documentation survive intact; anchors that resolve to no
    service are left exactly as they were rather than guessed at.
    """
    definitions = read_definitions(spec_text, compose, target_ref)
    lines = spec_text.splitlines(keepends=True)
    for definition in definitions:
        if definition.status in ("ok", "unresolved"):
            continue
        index = definition.line_no - 1
        indent = DEFINITION_RE.match(lines[index]).group("indent")
        ending = "\r\n" if lines[index].endswith("\r\n") else "\n"
        lines[index] = f"{indent}definition: {definition.url}{ending}"
    return "".join(lines), definitions


def build_source(args: argparse.Namespace) -> LocalRepo | GitHubRepo:
    if args.repo:
        path = Path(args.repo).expanduser()
        if not (path / ".git").exists():
            sys.exit(f"not a git clone: {path}")
        return LocalRepo(path)
    return GitHubRepo(args.github_repo)


def spec_path(args: argparse.Namespace) -> Path:
    if args.spec:
        return Path(args.spec).expanduser()
    from env import get_env  # Imported lazily so `services` needs no spec at all.

    return get_env().STACKMAP_SPEC_PATH


def cmd_services(args: argparse.Namespace) -> int:
    source = build_source(args)
    sha = source.resolve(args.ref)
    compose = ComposeFiles(source, sha)
    print(f"{source} @ {sha} ({args.ref}, {source.describe(sha)})\n")
    for path in args.files:
        print(path)
        for block in compose.services(path).values():
            profiles = ", ".join(block.profiles) or "-"
            print(f"  {block.name:24} {block.anchor:14} {profiles}")
        print()
    return 0


def _report(definitions: list[Definition], compose: ComposeFiles) -> None:
    width = max((len(d.container) for d in definitions), default=0)
    for definition in definitions:
        anchor = definition.block.anchor if definition.block else "?"
        flag = {
            "ok": "",
            "drift": "  DRIFT",
            "repin": "  REPIN",
            "unresolved": "  NO SUCH SERVICE",
        }
        print(
            f"  {definition.container:{width}}  {definition.path:33}"
            f"  {definition.old_anchor:12} -> {anchor:12}{flag[definition.status]}"
        )

    counts = {status: 0 for status in ("ok", "drift", "repin", "unresolved")}
    for definition in definitions:
        counts[definition.status] += 1
    print(
        f"\n{len(definitions)} anchors: {counts['ok']} ok, "
        f"{counts['drift']} drifted, {counts['repin']} to re-pin, "
        f"{counts['unresolved']} unresolved"
    )

    # Services the spec doesn't cover at all — the other half of keeping it in
    # sync, since a service added to a compose file needs a new container
    # entity, which this script can't invent.
    for path in compose.paths:
        referenced = {
            definition.block.name
            for definition in definitions
            if definition.path == path and definition.block
        }
        missing = [
            block
            for name, block in compose.services(path).items()
            if name not in referenced
        ]
        if missing:
            print(f"\nnot referenced by any container, in {path}:")
            for block in missing:
                profiles = ", ".join(block.profiles) or "-"
                print(f"  {block.name:24} {block.anchor:14} {profiles}")


def cmd_check(args: argparse.Namespace) -> int:
    source = build_source(args)
    sha = source.resolve(args.ref)
    compose = ComposeFiles(source, sha)
    path = spec_path(args)
    definitions = read_definitions(path.read_text(), compose, sha if args.pin else None)
    print(f"{source} @ {sha} ({args.ref}, {source.describe(sha)})")
    print(f"spec: {path}\n")
    _report(definitions, compose)
    return 1 if any(d.status != "ok" for d in definitions) else 0


def cmd_update(args: argparse.Namespace) -> int:
    source = build_source(args)
    sha = source.resolve(args.ref)
    compose = ComposeFiles(source, sha)
    path = spec_path(args)
    text = path.read_text()
    rewritten_text, definitions = rewrite_definitions(
        text, compose, sha if args.pin else None
    )

    print(f"{source} @ {sha} ({args.ref}, {source.describe(sha)})")
    print(f"spec: {path}\n")
    _report(definitions, compose)

    rewritten = sum(1 for d in definitions if d.status not in ("ok", "unresolved"))
    if not rewritten:
        print("\nnothing to rewrite")
        return 0
    path.write_text(rewritten_text)
    print(f"\nrewrote {rewritten} definition line(s) in {path}")
    if any(d.status == "unresolved" for d in definitions):
        print("left unresolved anchors alone — check whether those services were renamed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--ref",
        default="master",
        help="branch, tag or sha to compute line numbers at (default: master)",
    )
    parser.add_argument(
        "--repo",
        help="path to a local openlibrary clone; omit to read from GitHub instead",
    )
    parser.add_argument(
        "--github-repo",
        default=DEFAULT_GITHUB_REPO,
        help=f"owner/name to read from when --repo is omitted (default: {DEFAULT_GITHUB_REPO})",
    )
    parser.add_argument(
        "--spec",
        help="path to stack.yaml; defaults to STACKMAP_SPEC_PATH (see env.py)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    services = subparsers.add_parser(
        "services", help="list every service in a compose file with its line range"
    )
    services.add_argument(
        "files",
        nargs="*",
        default=[
            "compose.production.yaml",
            "compose.staging.yaml",
            "scripts/solr_builder/compose.yaml",
        ],
        help="compose files to read (default: the three the spec points at)",
    )
    services.set_defaults(func=cmd_services)

    check = subparsers.add_parser(
        "check", help="report which of the spec's anchors have gone stale"
    )
    check.set_defaults(func=cmd_check)

    update = subparsers.add_parser(
        "update", help="rewrite the spec's anchors in place"
    )
    for subparser in (check, update):
        subparser.add_argument(
            "--pin",
            action=argparse.BooleanOptionalAction,
            default=True,
            help="write the resolved sha into the URL instead of a branch name, so "
            "anchors stay correct rather than being right only until the next "
            "compose edit (default: --pin)",
        )
    update.set_defaults(func=cmd_update)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fetch OS release and end-of-life dates into a JSON file.

Run at image build time (see the Dockerfile) so the server carries the data
rather than reaching for it: the production hosts have no outbound network,
and a dataset that only changes when a distro ships a release is a poor
reason to need any.

The output is `{product: [release, ...]}`, trimmed to the fields the
frontend shows. Products that can't be fetched are skipped with a warning —
one distro being unavailable shouldn't fail a build — but fetching nothing
at all is an error, since that silently ships an image with no dates in it.

    scripts/fetch-os-releases.py --out server/os-releases.json debian ubuntu

Standard library only, so it runs in a bare build stage with no pip install.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

API = "https://endoflife.date/api/v1/products"

# Mirrors EOL_FIELDS in server/main.py — the rest of each release is noise
# to the frontend.
FIELDS = ("name", "label", "codename", "releaseDate", "eolFrom", "ltsFrom", "isLts", "isEol", "isMaintained")


def fetch(product: str, timeout: float) -> list[dict]:
    with urllib.request.urlopen(f"{API}/{product}/", timeout=timeout) as response:
        payload = json.load(response)
    return [{k: r.get(k) for k in FIELDS} for r in payload["result"]["releases"]]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("products", nargs="+", help="endoflife.date product names, e.g. debian ubuntu")
    parser.add_argument("--out", required=True, help="where to write the JSON")
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args(argv)

    releases = {}
    for product in args.products:
        try:
            releases[product] = fetch(product, args.timeout)
            print(f"  {product}: {len(releases[product])} releases", file=sys.stderr)
        except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
            print(f"  {product}: skipped ({e})", file=sys.stderr)

    if not releases:
        print("fetch-os-releases: nothing could be fetched", file=sys.stderr)
        return 1

    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(releases, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"wrote {args.out} ({len(releases)} products)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

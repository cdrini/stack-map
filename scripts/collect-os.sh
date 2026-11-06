#!/usr/bin/env bash
#
# Collect each VM's OS and version over SSH and record them in stack.yaml.
#
# Run from a machine that can reach the VMs — this does no writing of its
# own, it gathers facts and hands them to stackmap.py, which owns the spec.
#
#   scripts/collect-os.sh                    # every VM in the spec
#   scripts/collect-os.sh ol-web0 ol-db0     # just these
#   scripts/collect-os.sh --dry-run          # report, write nothing
#
# Environment:
#   STACKMAP_SPEC_PATH  spec to read and update (passed through to stackmap.py)
#   STACKMAP_DOMAIN     appended to each VM id to get a hostname
#                       (default: us.archive.org; set empty to use ids as-is)
#   STACKMAP_SSH_USER   ssh user, if not the one your ssh config picks
#   SSH_OPTS            extra ssh options, word-split
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
stackmap="$here/stackmap.py"
domain=${STACKMAP_DOMAIN-us.archive.org}
dry_run=

args=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=--dry-run ;;
    -h | --help)
      sed -n '2,/^set /p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; $d'
      exit 0
      ;;
    -*)
      echo "collect-os: unknown option $arg" >&2
      exit 2
      ;;
    *) args+=("$arg") ;;
  esac
done

if [ ${#args[@]} -eq 0 ]; then
  mapfile -t args < <("$stackmap" vms)
fi
if [ ${#args[@]} -eq 0 ]; then
  echo "collect-os: no VMs to visit" >&2
  exit 1
fi

# `. /etc/os-release` is the one interface every distro since ~2012 agrees
# on. ID/VERSION_ID are the machine-readable pair (ubuntu, 22.04); the
# fallbacks keep a VM that predates it from coming back empty.
read -r -d '' probe <<'REMOTE'
if [ -r /etc/os-release ]; then
  . /etc/os-release
  printf '%s\t%s\n' "${ID:-unknown}" "${VERSION_ID:-${BUILD_ID:-unknown}}"
else
  printf '%s\t%s\n' "$(uname -s | tr '[:upper:]' '[:lower:]')" "$(uname -r)"
fi
REMOTE

failed=()
for vm in "${args[@]}"; do
  host=$vm${domain:+.$domain}
  target=${STACKMAP_SSH_USER:+$STACKMAP_SSH_USER@}$host

  # BatchMode so an unreachable host fails fast instead of sitting on a
  # password prompt halfway through a fleet-wide run.
  if ! out=$(ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
    ${SSH_OPTS:-} "$target" "$probe" 2>/dev/null); then
    echo "  $vm: ssh failed" >&2
    failed+=("$vm")
    continue
  fi

  IFS=$'\t' read -r os version <<<"$out"
  if [ -z "${os:-}" ] || [ -z "${version:-}" ]; then
    echo "  $vm: no os-release data" >&2
    failed+=("$vm")
    continue
  fi

  "$stackmap" set "$vm" "os=$os" "osVersion=$version" ${dry_run:+$dry_run} |
    sed 's/^/  /'
done

if [ ${#failed[@]} -gt 0 ]; then
  echo >&2
  echo "collect-os: ${#failed[@]} unreachable: ${failed[*]}" >&2
  exit 1
fi

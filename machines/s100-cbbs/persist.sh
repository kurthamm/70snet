#!/usr/bin/env bash
# Spec §11's persistence gate: a posted message survives a host restart, and
# carries the room's date rather than today's.
set -euo pipefail
cd "$(dirname "$0")"
exec python3 tools/persist.py "$@"

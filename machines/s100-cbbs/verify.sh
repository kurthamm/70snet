#!/usr/bin/env bash
# Spec §11 gate: the real software answers a call.
set -euo pipefail
cd "$(dirname "$0")"
exec python3 tools/verify.py "$@"

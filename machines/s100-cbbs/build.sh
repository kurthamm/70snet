#!/usr/bin/env bash
# Assemble CBBS 3.5 from the archived source, using the period LINKASM
# assembler that ships alongside it, running under CP/M 2.2.
#
# This is spec §11's "CBBS build reproducibility" gate: if this does not
# produce a working binary, the "real software" claim does not hold.
set -euo pipefail
cd "$(dirname "$0")"
./setup.sh
exec python3 tools/build.py "$@"

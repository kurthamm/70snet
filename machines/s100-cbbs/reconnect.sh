#!/usr/bin/env bash
# Gate: after a caller hangs up, the NEXT caller gets a fresh sign-on.
#
# CBBS has one phone line, so callers take turns -- this is the normal path,
# not an edge case. It runs as its own process because that is how the
# switchboard runs it: a long-lived server owning FIFO streams across an
# emulator restart.
set -euo pipefail
cd "$(dirname "$0")/../.."

# The scenario can legitimately exit non-zero (a failed call). Capture its
# status without `set -e` aborting the script before the diagnostics and FAIL
# handling below get to run.
set +e
out=$(node --experimental-strip-types \
  packages/cbbs-host/src/fixtures/reboot-scenario.ts \
  "$PWD/machines/s100-cbbs" 2>&1)
status=$?
set -e

echo "$out" | tail -3
if ! echo "$out" | grep -q '"ok":true'; then
  echo "FAIL: the second caller did not get a fresh sign-on (scenario exit status $status)"
  exit 1
fi
echo "PASS: a second caller gets a fresh CBBS sign-on after a hangup"

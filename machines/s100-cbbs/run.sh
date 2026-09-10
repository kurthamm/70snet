#!/usr/bin/env bash
# Boot the CBBS host machine.
#
# Drive A: CP/M 2.2 system
# Drive C: CBBS.COM and its message base, built by build.sh for a room's date
#
# The telephone line is this machine's CONSOLE: CBBS does its terminal I/O
# through the CP/M BIOS console vectors, and on the original machine that
# console was the modem. Carrier and off-hook live on I/O port 0FFH.
#
# cpmsim opens its disk images relative to its own working directory, so every
# instance needs its OWN directory or two machines silently corrupt each
# other's disks. Set SEVENTIESNET_WORKDIR to get an isolated machine; without
# it the emulator's own directory is used, which is fine for one-at-a-time
# tooling like build.sh but NOT for a supervisor that may start several.
set -euo pipefail
cd "$(dirname "$0")"
Z="$PWD/vendor/z80pack/cpmsim"

WORK="${SEVENTIESNET_WORKDIR:-$Z}"
mkdir -p "$WORK/disks"

rm -f "$WORK/disks/drivea.dsk"
cp "$Z/disks/library/cpm22-1.dsk" "$WORK/disks/drivea.dsk"
if [ -f disks/cbbs-drive-c.dsk ]; then
  rm -f "$WORK/disks/drivec.dsk"
  cp disks/cbbs-drive-c.dsk "$WORK/disks/drivec.dsk"
fi

# Drive B must exist even though CBBS keeps its data on the current drive:
# CP/M touches B: and an absent image reports "Bdos Err On B: Bad Sector"
# straight down the telephone line to the caller.
rm -f "$WORK/disks/driveb.dsk"
if [ -f disks/cbbs-drive-b.dsk ]; then
  cp disks/cbbs-drive-b.dsk "$WORK/disks/driveb.dsk"
else
  cp "$Z/disks/library/cpm22-2.dsk" "$WORK/disks/driveb.dsk"
fi

if [ "$WORK" != "$Z" ]; then
  ln -sf "$Z/cpmsim" "$WORK/cpmsim"
  # cpmsim forks cpmrecv for its auxiliary device and, if it cannot exec it,
  # does kill(0, SIGQUIT) -- taking down the whole process group, including
  # whatever started us. It looks for ./srctools/cpmrecv first, so the
  # isolated directory needs that path to exist.
  ln -sfn "$Z/srctools" "$WORK/srctools"
fi

cd "$WORK" && exec ./cpmsim "$@"

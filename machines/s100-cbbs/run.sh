#!/usr/bin/env bash
# Boot the CBBS host machine.
#
# Drive A: CP/M 2.2 system
# Drive C: CBBS.COM and its message base, built by build.sh for a room's date
#
# The telephone line is this machine's CONSOLE: CBBS does its terminal I/O
# through the CP/M BIOS console vectors, and on the original machine that
# console was the modem. Carrier and off-hook live on I/O port 0FFH.
set -euo pipefail
cd "$(dirname "$0")"
Z=vendor/z80pack/cpmsim
rm -f "$Z/disks/drivea.dsk"
cp "$Z/disks/library/cpm22-1.dsk" "$Z/disks/drivea.dsk"
if [ -f disks/cbbs-drive-c.dsk ]; then
  rm -f "$Z/disks/drivec.dsk"
  cp disks/cbbs-drive-c.dsk "$Z/disks/drivec.dsk"
fi
cd "$Z" && exec ./cpmsim "$@"

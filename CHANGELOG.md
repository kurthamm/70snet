# Changelog

## Unreleased

### Added
- Design spec for the 1980 computer room (`docs/superpowers/specs/`), covering
  the telephone exchange, destinations and eras, media and the disk box, and
  the room's physical interface.
- Plan A, "The phone call" (`docs/superpowers/plans/`) — eleven tasks from the
  CBBS spike through to a working room.
- `machines/s100-cbbs/` — the CBBS host. Assembles CBBS 3.5 from the archived
  1981 source using the period `LINKASM` assembler that ships with it, under
  CP/M 2.2 on an emulated S-100 machine, and boots it.
  - `build.sh` — assembles CBBS and builds a room's message base
  - `verify.sh` — the *real software* gate: logs in and reads a 1978 message
  - `run.sh` — boots the host

### Changed
- `cpmsim` carries one local patch: a modem control port at `0FFH` providing
  the carrier, ring and off-hook bits `cbbsmodm.asm` expects.

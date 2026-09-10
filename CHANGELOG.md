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
  - `persist.sh` — proves a posted message outlives the machine, stamped with
    the room's date
  - `run.sh` — boots the host

- The telephone exchange (`packages/exchange`), which enforces per-destination
  line counts — CBBS had one line, so the second caller gets a busy signal.
- Rooms and destinations as data (`packages/registry`), keyed by era.
- The line protocol and a 300-baud pacer (`packages/protocol`).
- The on-screen telephone and its sounds (`apps/web`): Bell 103 tones, rotary
  dialling at its real speed, and 300-baud FSK that is audible only until the
  handset goes down.
- A telephone-line serial backend in our `apple2ts` fork.

### Changed
- `cpmsim` carries one local patch, which does two things:
  - the machine's **console becomes the telephone line** — four 8-bit-clean
    FIFOs — because CBBS does its terminal I/O through the CP/M BIOS console
    vectors, and on the original machine that console was the modem;
  - a **Scitronics clock** at ports 24-27 reporting the *room's* date, so CBBS
    date-stamps its own messages and the timeline comes from the 1981 software
    rather than from us.

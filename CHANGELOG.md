# Changelog

## Mothballed — 2026-09-10

Work stopped here. Plan A is complete, merged and deployed; Plan B is two
tasks of eight. See README "State" for what is and is not built.

### Added
- **Deployed at https://70snet.hamm.me** — one host, one process, behind a
  Cloudflare tunnel. `70snet.service` and `cloudflared-70snet.service`, both
  enabled. `deploy/build.sh` runs before every start, so a pull plus a restart
  is a deploy.
- **The room, rebuilt.** Two views: a wide shot of the 1980 room, and a desk
  view per machine with the CRT dominant, a touch-tone keypad playing true DTMF
  pairs, a museum card, and the disk box as an object.
- **Plan B tasks 1-2.** `packages/media` — the media model and the rule that a
  room shows only what the visitor owned by its date. `packages/storage` —
  the visitor's own browser, keeping `persist()`'s three outcomes distinct,
  because "false" is not "unavailable".

### Fixed
- Dialling did nothing for two reasons: the pressed digits were never
  displayed, and pressing one with the handset down threw a rejection nobody
  caught. Keys are disabled until the handset is lifted, and the number shows
  as it is typed.
- The keypad played touch-tone but the dial waited rotary pulse time -- 1.7
  seconds for a 0. Dialling is now a named mode on the modem.
- Twenty review findings before the merge, three critical: Hayes dialling read
  an attribute only the rotary path set, one malformed frame could take the
  server down, and the reconnect fixture leaked an emulator on every run.

## Earlier

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

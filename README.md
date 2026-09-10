# 70snet

Recreating what it was like to use a personal computer before the IBM PC —
Apple, Commodore, Tandy, Atari and the S-100 CP/M machines — as a website with
live, hands-on emulated machines.

The machines run in your browser. The only thing that travels over the internet
is the phone line, which is exactly how it worked in 1980.

**Live at https://70snet.hamm.me** · **Status: mothballed 2026-09-10** — see
[State](#state) below.

## The idea

These computers were not networked. There was no LAN worth recreating. What
connected a home computer to the world was a 300-baud modem and a phone call —
so the fabric of this project is a **simulated telephone exchange**.

Every destination allows exactly the number of simultaneous callers the real
service had. CBBS in Chicago had one phone line, so if someone else is on it,
you get a busy signal. Really. Half of being online in 1980 was failing to get
online, and that scarcity is the point.

## What works today

You can open the room, click the Apple II+, switch it on, lift the handset,
dial `312-545-8086`, and read messages Ward Christensen posted in **February
1978** — on his own software.

CBBS is not a reimplementation. It is CBBS 3.5, assembled from the archived
1981 source by `LINKASM.COM`, the period assembler that ships on the same disk,
running under CP/M 2.2 on an emulated S-100 machine. Post a message and CBBS
stamps it with the room's date, read from an emulated Scitronics clock at the
I/O ports its own driver expects. Hang up and the next caller gets a fresh
sign-on. Call while someone else is connected and you get a busy signal,
because the board has one line.

| | |
|---|---|
| Tests | 71 across 11 files |
| Types | `tsc -b` clean, 8 projects |
| Machine gates | `verify.sh`, `persist.sh`, `reconnect.sh` |

## Running it

```bash
pnpm install
deploy/build.sh                 # builds the room page and bundles the server
machines/s100-cbbs/build.sh     # assembles CBBS from the 1981 source
node apps/switchboard/dist/server.bundle.mjs
```

One process serves the room page, the Apple II emulator and the telephone
exchange, so the page dials the host that served it.

### The gates

```bash
machines/s100-cbbs/verify.sh      # CBBS answers and serves a 1978 message
machines/s100-cbbs/persist.sh     # a posted message outlives the machine
machines/s100-cbbs/reconnect.sh   # the next caller gets a fresh sign-on
pnpm vitest run                   # the suite
```

`verify.sh` is the gate on the *real software* claim: if the archived source
stops assembling to a working binary, that claim no longer holds.

## Architecture

```
70snet.hamm.me ──cloudflared──► one host, one process
                                 ├── room page (static)
                                 ├── /apple2ts/ (emulator, runs in the browser)
                                 └── WebSocket ──► exchange ──► cpmsim + CBBS
```

The emulator runs on the visitor's own CPU, so twenty visitors do not slow each
other down — and it is the historically correct arrangement, since in 1980 the
computer sat on your desk and only the phone line left the house.

The exchange, the CBBS host and their disk images cannot be serverless: a call
is a held-open WebSocket, the busy signal is in-memory state, and the message
base is a disk image that must survive between callers.

### Deployment on this machine

| Unit | Does |
|---|---|
| `70snet.service` | builds, then serves everything on port 8470 |
| `cloudflared-70snet.service` | the tunnel for `70snet.hamm.me` |

```bash
sudo systemctl {status,restart,stop} 70snet.service
sudo systemctl {status,restart,stop} cloudflared-70snet.service
```

Both are enabled, so they return after a reboot. To mothball completely,
`sudo systemctl disable --now` both; nothing else needs undoing.

`70snet.service` runs `deploy/build.sh` before every start, so a `git pull`
plus a restart is a deploy. It deliberately does **not** install dependencies —
run `pnpm install` yourself after a pull.

## State

**Plan A — the phone call: complete and merged.** The room, the Apple II+, the
exchange, CBBS, the telephone, the busy signal, and the deployment above.

**Plan B — the disk box: tasks 1 and 2 of 8.** `packages/media` (the media
model and its era-visibility rule) and `packages/storage` (browser storage,
with `persist()`'s three outcomes kept distinct). Tasks 3–8 — the drive, the
box on the desk, uploads, export/import, disk transfer by phone call, and the
curated starter set — are specified but not built.

**The machines have nothing to put in them.** That is the honest headline of
where this stopped: you can dial a board, but you cannot yet put a diskette in
the drive, because the media subsystem is Plan B. The disk box appears on the
desk and says so when clicked.

### Known weaknesses

- **The desk scene is CSS and SVG standing in for a photograph.** No camera,
  and stock period imagery brings licensing problems. It is the weakest part of
  the presentation.
- **The hangup-then-reconnect path is gated by a shell script, not the test
  suite.** It cannot complete inside a vitest worker while passing standalone
  every time; `machines/s100-cbbs/reconnect.sh` covers it.
- **`packages/storage`'s IndexedDB round-trip is not unit-tested.** It is typed
  strictly and sits behind a fakeable interface; Task 3 would exercise it.
- **The 1980 phone is touch-tone.** Most 1980 homes were rotary. Chosen for
  usability and recorded in the anachronism register; rotary is implemented and
  one data change away.

## Documentation

- `docs/superpowers/specs/` — the design, and the reasoning behind it
- `docs/superpowers/plans/` — Plan A (done) and Plan B (tasks 1–2 done)
- `DECISIONS.md` — the pivots, and why
- `CHANGELOG.md` — what landed

## Sources

CBBS 3.5, its documentation and the 1981 BBS list come from Jason Scott's BBS
Software Directory. The emulators are `z80pack` (Udo Munk) and `apple2ts`
(ct6502), both MIT, both vendored as pinned submodules with our changes carried
as patches or on a branch of our fork.

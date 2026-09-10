# 70snet — Design

**Date:** 2026-09-09
**Status:** Approved in brainstorming; awaiting spec review
**First room:** Fall 1980

## 1. Purpose

Recreate what it was like to use a personal computer in the years before the
IBM PC — Apple, Commodore, Tandy, Atari, and the S-100 CP/M machines — as a
public website with live, hands-on emulated machines.

The sibling project `~/arpanet` recreates the 1972 ARPANET: real machines
running recovered historical software, connected by emulated IMPs, reachable
through a browser. 70snet applies the same standard to the microcomputer era,
with one crucial difference in the fabric.

### The central insight

**In 1980, the network was the telephone system.**

These machines were not networked. There was no LAN worth recreating: Corvus
Constellation and Nestar Cluster/One arrived in 1980 and were rare and
expensive. What actually connected a home computer to the world was a 300-baud
modem and a phone call.

So the fabric of this project is a **simulated telephone exchange**, not a
network. And the defining experience of going online in 1980 was not
connecting — it was the **busy signal**, because the hobbyist boards had one
phone line each. Half of being online in 1980 was failing to get online.

That scarcity is the feature, not a limitation to engineer away.

## 2. Architectural principle: rooms are data

The project will have more than one room. Other candidate eras were discussed
and remain likely: 1977 (the Trinity year), 1983 (Commodore 64, 1200 baud,
ANSI art), and the 1981 boundary where the IBM PC arrives.

Therefore **no room may be hardcoded.** A room is a data definition the engine
reads. Anything that differs between eras belongs in that definition:

| Varies by room | Examples |
|---|---|
| Machines present | Apple II+, CBM 8032, TRS-80 Model III, Atari 800, S-100 CP/M |
| Modem per machine | Micromodem II (1979), acoustic coupler, Hayes Smartmodem (1981+) |
| Dialing convention | Manual dial (1980), Hayes `AT` autodial (1981+) |
| Line speed | 300 baud (1980), 1200 baud (1983), 2400 (1985) |
| Phone book | Real period BBS lists |

The 1980 room is the first instance of the engine, not the engine itself. Any
design decision that cannot survive a second room is wrong.

Note that **destinations are deliberately absent from that table.** The online
services spanned many years and many machines, so they are not a property of
any one room. A room declares its year; the destination registry decides what
was reachable then. See §5.

## 3. Scope of the first build

A **vertical slice**: one thin path through every layer, working end to end.
The project has five or six subsystems and several unknowns; building any one
layer completely before the others is the wrong order.

**In scope for v1:**

- The room page, showing the 1980 room, with only the Apple II+ live
- Apple II+ running in the visitor's browser, booting authentically to `]`
- An on-screen telephone and a period phone book
- The telephone exchange on the server
- CBBS as the single destination — one phone line, real busy signals
- Persistent messages: what a visitor posts is still there tomorrow

**Explicitly deferred:** the other five machines; Telenet and Tymnet;
CompuServe, The Source, Dow Jones; cassette loading; the Epson MX-80 printer;
VisiCalc and other application software; additional rooms.

If the slice works, adding the CBM 8032 and Forum-80 is repetition rather than
invention. If it fails, it fails somewhere cheap.

**One exception to the deferrals:** the date-stamping of messages and the
lifespan field on destinations (§5) are built in v1 even though v1 has a single
room and a single destination. Retrofitting a timeline onto an accumulated
message base later would mean guessing at dates that were never recorded.
Getting this wrong is not recoverable; it costs almost nothing now.

## 4. Components

### 4.1 The room page

A drawing of the 1980 computer room. Clicking a machine brings it to life in
the page. Each destination carries an honesty label — *real software* or
*reconstruction* — the way a museum labels a replica.

### 4.2 The visitor's machine — in the visitor's browser

**Decision: emulation runs client-side, not on the server.**

Rejected alternative: run MAME server-side and stream video to the browser.
That option was rejected on user-experience grounds, not cost:

- **Input latency.** Every keystroke would round-trip browser → server → MAME →
  video encode → browser: 50–150ms before a character appears. On a machine
  that echoed instantly, that lag is constantly wrong, and typing is nearly
  all the visitor does.
- **Compression destroys 40-column text.** Video codecs are tuned for camera
  footage, not 7×8 pixel glyphs.
- **Client-side allows a *more* authentic display,** not less: a WebGL CRT
  treatment with scanlines, phosphor persistence, and the NTSC colour-artifact
  fringing that gives Apple II hi-res its characteristic look. Streaming would
  compress all of that away.
- **It degrades gracefully.** Each visitor brings their own CPU, so twenty
  simultaneous visitors do not slow each other down. This is what makes
  "everyone gets their own room" affordable at all.

It is also the historically correct arrangement: in 1980 the computer sat on
your own desk, and the only thing that left the house was the phone line.

**Chosen emulator: `apple2ts`** (github.com/ct6502/apple2ts, MIT, TypeScript,
actively maintained). Verified 2026-09-09 to contain:

- A real **Super Serial Card** — genuine `341-0065-A` ROM plus SY6551 ACIA
  emulation, at `src/worker/devices/superserial/`
- A **Z80 SoftCard** (`src/worker/devices/softcard.ts`) — the actual 1980 card
  that ran CP/M on an Apple II. Available for later increments.
- A **serial hub** at `src/ui/devices/serial/serialhub.ts` with a clean
  two-function boundary: `receiveCommData(data)` for bytes leaving the Apple,
  `passRxCommData(data)` for bytes arriving. Existing backends are WebSerial
  (a real physical port) and the built-in ImageWriter printer.

**Our modification:** add a third serial backend — a WebSocket to the exchange.
This is roughly forty lines at exactly the right seam. No structural fork.

Rejected: `apple2js` (whscullin, also MIT) has no serial card at all — its
card set is CFFA, Disk II, language card, mouse, NSC, parallel, RAMFactor,
SmartPort, Thunderclock, Videoterm. A 6551 card would have to be written from
scratch.

### 4.3 The telephone exchange — the original work

A server-side switchboard. This is the only component built from nothing, and
the project's character lives here. Responsibilities:

- Hold the phone-number map for the active room
- Model call setup: dial → ring → answer → carrier handshake → connected
- **Enforce per-destination line counts, and return a busy signal when full**
- Model the era's line speed as real pacing — 300 baud is 30 characters per
  second and must *feel* like it
- Model call teardown, including carrier loss
- Know what year it is, and apply that era's dialing convention

**Reference:** `tcpser` solves an adjacent problem (presenting a Hayes-command
modem over TCP) and is worth reading. It is not directly reusable: `AT`
commands are 1981, and the 1980 room dials manually.

### 4.4 CBBS — real historical software

**Verified 2026-09-09.** Jason Scott's BBS Software Directory
(`software.bbsdocumentary.com/AAA/AAA/CBBS/`) holds both 8" disks of **CBBS
3.5** as actual 8080 assembly source, including:

- `CBBS.ASM`, `CBBSFUNC.ASM` (main menu), `CBBSENT1/2.ASM` (message entry),
  `CBBSDISK.ASM` (disk I/O), `CBBSBYE.ASM`
- `CBBSHAYS.ASM` — D.C. Hayes modem-dependent code
- `CBBSCLKS.ASM` / `CBBSCLKC.ASM` — Scitronics and CompuTime clock cards
- `cookbook.txt` — the CBBS Cookbook installation guide
- `1981cbbslist.txt` — a period list of BBS phone numbers, usable as the
  in-room phone book
- Version histories for 3.3 and 3.4

Christensen and Suess's own requirements sheet, **dated 06/08/80**, specifies:

> Language: 8080 Assembler; ~8300 lines of source... Op. sys.: Standard CP/M
> (at 0000H). Memory size: 28K or larger. Diskette requirements: Single 8"
> 'OK', dual 8" best. Modem: PMMI, IDS, Hayes supported, as well as skeletal
> code for an outboard modem.

**Host machine:** an emulated S-100 CP/M system. `z80pack` (Udo Munk) is the
leading candidate because it ships bootable CP/M 2.2 images with 8" drives.
`simh`'s `altairz80` is the fallback and is already packaged (`apt`, 3.8.1).

**Modem attachment:** CBBS ships "skeletal code for an outboard modem," which
lets us attach a plain serial port rather than emulating a PMMI MM-103 or Hayes
80-103A card at specific I/O addresses. This is the pragmatic path. See risks.

## 5. Destinations, concurrency, and time

### 5.1 Destinations are not owned by rooms

The online services outlived the machines. CompuServe ran from 1979 to 2009,
The Source from 1979 to 1989, Telenet and Tymnet across the whole era, CBBS
itself from 1978 into the mid-1980s. A destination therefore spans many rooms,
many years, and many computer models.

**So destinations live in their own registry, independent of rooms.** A room
does not define its destinations; it declares its year, and the exchange
presents whichever destinations were alive that year.

Each destination carries:

| Property | Notes |
|---|---|
| Lifespan | Start and end date. A room only sees destinations alive in its year. |
| Line count **per era** | Not fixed. CompuServe grew from a handful of ports to hundreds. |
| Supported speeds per era | CBBS at 300 baud in 1980; 1200 available on many services by 1983. |
| Access method per era | Direct dial, or reached through Telenet/Tymnet. |
| Presentation per era | The service itself changed. See §5.2. |

### 5.2 Services evolve; they are not one frozen thing

CompuServe in 1980 is **MicroNET** — 300 baud, CB Simulator newly launched. By
1983 it is renamed, larger, faster, and by 1984 it has the Electronic Mall.
Presenting a single timeless CompuServe would be the same mistake as
hardcoding a room.

A destination is therefore versioned along the timeline, and a room reaches the
version contemporary with its year.

### 5.3 The timeline is the shared axis

This is the most interesting consequence, and it is historically true rather
than a contrivance: **a message base accumulates across years.** A board's
messages in 1983 included messages left in 1980. That is simply how these
services worked.

So the rooms are connected through time rather than through space:

- **Every message is stamped with the in-fiction date of the room that wrote
  it.**
- **A room shows only messages stamped at or before its own era.** A visitor in
  the 1980 room writes; a visitor in the 1983 room reads it as history. Nothing
  from 1983 is ever visible in 1980 — no time travel.

This gives cross-era, one-directional, asynchronous communication between
rooms, at no cost to historical honesty, and it makes the later rooms feel
inhabited rather than empty.

### 5.4 Live encounters are same-era only

Synchronous features — CompuServe's CB Simulator (1980), multi-user chat — pair
only visitors within the same room-era. Two people cannot be simultaneously
present in different years. Asynchronous messages cross time; live conversation
does not.

### 5.5 Line contention is per destination-era

A destination's line count is enforced within each era instance, not globally
across all rooms. A busy CBBS in the 1980 room does not block a caller in the
1983 room, because those are different points on the timeline. If real traffic
turns out to be thin enough that busy signals never occur, revisit this — the
busy signal is a feature and must actually happen.

### 5.6 Historical line counts

**Rule: each destination allows exactly the number of simultaneous callers the
real service had, in that era.** Scarcity is a property of the destination, not
a global setting. Private machines are free to hand out; shared destinations
are not.

| Destination | Lifespan | Lines | Note |
|---|---|---|---|
| CBBS (Chicago) | 1978 – mid-1980s | 1 | The famous single line. Everyone else gets a busy signal. Spans the 1980 and 1983 rooms. |
| ABBS | 1979 – early 1980s | 1 | |
| Forum-80 | 1980 – mid-1980s | 1 | |
| University PDP-11, RSTS/E | whole era | ~12 | Dial-in ports |
| CompuServe (MicroNET in 1980) | 1979 – 2009 | grows | A DEC KL-10; a handful of ports early, hundreds later |
| The Source | 1979 – 1989 | many | Reached via Telenet |
| Dow Jones News/Retrieval | 1974 – 1990s | many | Reached via Tymnet |

This produces exactly the right texture: the hobbyist boards are precious and
contended; the commercial services are always open and cost money by the hour.

## 6. Data flow: one phone call

1. Visitor opens the room page; the Apple II+ boots in their browser to `]`
2. Visitor looks up CBBS in the phone book and dials it on the on-screen phone
3. The browser opens a WebSocket to the exchange and requests that number
4. The exchange checks CBBS's line count
   - **Occupied:** returns a busy signal, audible and visible. Call over.
   - **Free:** reserves the line, returns ring, then CBBS answers
5. Carrier handshake; the visitor flips the modem to DATA
6. Bytes now flow: Apple's SSC → serial hub → WebSocket → exchange → CBBS's
   emulated serial port, and back, paced at 300 baud
7. Visitor reads and posts messages. Posts persist to CBBS's emulated disk.
8. Hangup, or carrier loss, releases the line for the next caller

## 7. Historical fidelity

### Anachronism register

Kept deliberately, and disclosed on the page:

| Item | Actual date | Target | Note |
|---|---|---|---|
| CBBS 3.5 | Nov 1981 | 3.3/3.4 would be right for fall 1980 | Only 3.5 survives as source; 3.3/3.4 survive as change docs |
| Apple Super Serial Card | 1981 | Micromodem II (1979) or Communications Card (1978) | What `apple2ts` emulates; MAME support for the earlier cards unconfirmed |

Deliberately excluded as anachronistic: the Hayes Smartmodem `AT` command set
(1981). The 1980 room dials by hand, on the handset, then switches to DATA.

### The seam to the ARPANET project

There *was* a real packet network reachable from these machines: **Telenet**
and **Tymnet**, public X.25 data networks. You dialed a local node, got an `@`
prompt, and typed a host address. Telenet was the commercial spin-out of
ARPANET, founded by BBN people. When 70snet grows a PDN layer, that is the
natural bridge to `~/arpanet` — the same lineage ten years later, reached from
a kid's Apple II instead of an IMP.

## 8. Error handling

Failures are era-appropriate wherever possible, and honest otherwise.

- **Destination full** → busy signal. Not an error; the intended experience.
- **Destination host down** → the phone rings and rings, unanswered.
- **WebSocket drops** → carrier loss. The Apple sees exactly what it would
  have seen in 1980.
- **CBBS host crashes** → the exchange reports the number as out of service,
  and an operator alert fires. Never a silent failure.
- **Emulator fails to start** → an explicit page-level error naming the cause.
  No blank screen, no fake terminal.

Per project convention: no fallbacks that mask failure, no stubs standing in
for the real destination, no placeholder data.

## 9. Testing

- **Exchange state machine** — unit tests for dial, ring, answer, busy,
  connect, hangup, carrier loss, line accounting
- **Concurrency** — two clients, one line: the second must receive busy
- **Baud pacing** — verify 300 baud delivers ~30 characters per second
- **CBBS build reproducibility** — assembling the archived source yields a
  working binary; this is the gate on the "real software" claim
- **End-to-end** — a headless client dials CBBS through the exchange and
  asserts the real login sequence appears
- **Persistence** — a posted message survives a host restart

## 10. Risks and open questions

1. **CBBS clock card.** CBBS wants a Scitronics or CompuTime clock. Whether
   the chosen S-100 emulator can present one, or whether the clock code needs
   stubbing, is unresolved. Stubbing a clock is acceptable; stubbing message
   handling is not.
2. **Outboard-modem path.** CBBS's skeletal outboard-modem code is documented
   but unproven by us. If it does not work, we must emulate a PMMI MM-103 or
   Hayes 80-103A at correct I/O addresses — a real increase in scope.
3. **Assembling 1981 source.** `LINKASM` and the original toolchain are
   referenced by the source. Reproducing the build may require period tools
   running under CP/M.
4. **CBBS 3.5 vs the 1980 target year.** Accepted and disclosed.
5. **Hosting.** Undecided. The exchange and CBBS host are long-lived
   processes, which rules out purely serverless hosting for those components.

## 11. Future rooms

Sketched only, to keep the engine honest — not commitments:

- **1977, the Trinity year** — Apple II, PET 2001, TRS-80 Model I at launch.
  Cassette tape, 4–16K, no disks, and *no destinations at all*. The room's
  point is isolation: the machines cannot talk to anything, including each
  other. This is a useful check on the model in §5: the 1977 room's emptiness
  is not a special case anyone codes: CBBS opens in February 1978, so the
  lifespan rule produces an empty phone book on its own.
- **1983** — Commodore 64, 1200 baud, a crowded BBS scene, ANSI art.
- **1981** — the boundary. The IBM PC arrives in August, and the Hayes
  Smartmodem makes the phone dial itself.

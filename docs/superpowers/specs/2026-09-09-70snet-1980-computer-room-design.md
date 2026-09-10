# 70snet — Design

**Date:** 2026-09-09
**Status:** Approved in brainstorming; awaiting spec review
**Revised:** 2026-09-09 — added §6 (media and the disk box); revised §2, §3
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
| Media and drives | Two Disk II drives (1980); cassette port only (1977) |
| Starter media | The curated box of diskettes a visitor finds in that room |

The 1980 room is the first instance of the engine, not the engine itself. Any
design decision that cannot survive a second room is wrong.

Note that **destinations are deliberately absent from that table.** The online
services spanned many years and many machines, so they are not a property of
any one room. A room declares its year; the destination registry decides what
was reachable then. See §5.

**The visitor's diskettes are absent for the opposite reason.** People owned
these machines for years, and a disk box accumulated across the whole era; a
box frozen at one year would be an artifact of how we drew the rooms rather
than anything true. The general rule the two cases share:

> **What is contended in the moment is pinned to an era. What accumulates
> crosses them.**

**The axis is simultaneity, not sharing.** Phone lines are contended in the
moment, and scarcity needs visitors concentrated at the same point in time — a
busy signal only happens because someone else is on the line right now. Nobody
contends for your floppies.

A message base is shared but *not* contended: it accumulates, and §5.3 requires
a 1983 room to read what 1980 wrote. So what is pinned to an era is the **line**,
never the **record**:

| | Keyed by | Filtered by |
|---|---|---|
| Call occupancy (§5.5) | destination **and era** | — |
| Message base (§5.3) | destination | `messageDate <= room.date` |
| The visitor's box (§6.2) | the visitor | `acquired <= room.date` |

The last two rows are the same rule applied to a shared record and a private
possession. A room governs **what you can reach, never what you own.** See §6.

## 3. Scope of the first build

A **vertical slice**: one thin path through every layer, working end to end.
The project has five or six subsystems and several unknowns; building any one
layer completely before the others is the wrong order.

**In scope for v1:**

- The room page, showing the 1980 room, with only the Apple II+ live
- Apple II+ running in the visitor's browser, booting authentically — which
  means an empty Disk II grinding until the visitor puts a diskette in it
- A disk box: curated diskettes, insert and eject, the write-protect notch
- Diskettes kept in the visitor's own browser, and exportable as files
- Visitor uploads of their own disk images
- An on-screen telephone and a period phone book
- The telephone exchange on the server
- CBBS as the single destination — one phone line, real busy signals
- Machine-to-machine calls: XMODEM disk transfer between two visitors
- Persistent messages: what a visitor posts is still there tomorrow

**Explicitly deferred:** the other five machines; Telenet and Tymnet;
CompuServe, The Source, Dow Jones; cassette loading; the Epson MX-80 printer;
VisiCalc and other application software; additional rooms; visitors sharing
disk boxes through our server rather than over the phone.

**Not deferred but impossible:** downloading files from a board. CBBS has no
file transfer of any kind — see §5.7 — so in this era a disk moves between two
people who call each other directly, which is what XMODEM was written for.

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

**A visitor can dial without any communications software.** The card's full 2K
firmware is present, and it includes Terminal Mode: `IN#2` at a BASIC prompt,
then Ctrl-A T, and the Apple is a dumb terminal.

Reaching that prompt is itself a deliberate act on this machine. The Disk II
grinds at power-on (§6.4) and never gets to `]` on its own; `RESET` (§7.2)
breaks out of the boot attempt into Applesoft. So dialling needs no diskette,
but it does need the visitor to know that — which is what §7.4's manuals are
for. The disk box is not what makes v1 work; it is what makes the room worth
being in, and what everything past dialling requires.
File transfer in particular needs real comms software on a diskette. See §6.7.

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

### 5.7 What the boards could not do

**Verified 2026-09-09: CBBS has no file transfer.** Across all thirty `.ASM`
files there is no reference to XMODEM, download, upload, or file transfer of any
kind. `CBBSRTRV.ASM` retrieves *messages*, not files. CBBS was a message system
and nothing else, which matches the history: XMODEM shipped separately as
Christensen's `MODEM.ASM`, and the file-trading boards came later.

Adding downloads to CBBS would mean modifying it, which would forfeit the *real
software* claim that §11 makes the gate on this project. We will not do it.

The period-correct answer is better anyway. In 1980 you did not download a disk
from a board — **you called the other person.** You arranged it in advance, both
sides ran `MODEM.ASM`, one typed send and the other typed receive, and the file
crossed at 300 baud. That is precisely what Christensen wrote XMODEM for in
1977: so he and Suess could exchange files. See §6.7.

## 6. Media: the diskettes and the box

The machines have no hard drives. Software came on removable media, and a
visitor who cannot handle that media cannot do anything past dialling.

### 6.1 Media, not diskettes

The engine's unit is a **medium** — one physical thing you can hold — because
§13's 1977 room is cassette-only and a diskette-shaped abstraction would not
survive it:

```ts
interface Medium {
  id: string
  kind: "diskette-5.25" | "diskette-8" | "cassette" | "cartridge"
  format: "dsk" | "do" | "po" | "woz" | "nib" | "wav"
  label: string           // what is written on it, in marker
  title?: string          // catalogue information, for the honesty card
  publisher?: string
  released?: string       // when the software came out
  acquired: string | "undated"  // in-fiction date it entered this box
  writeProtected: boolean // the notch — real state, not decoration
  provenance: "curated" | "uploaded" | "formatted" | "received"
  fidelity?: "real-software" | "reconstruction"   // curated media only
}
```

`provenance` drives the honesty label, extending §4.1's museum convention from
destinations to media. We vouch for curated media and say whether each is real
or reconstructed. An uploaded disk's card says plainly that a visitor brought
it and that we make no claim about it — which is both honest and the only
defensible posture, since we never inspected it.

### 6.2 The box is private, and it accumulates

A visitor's box is theirs. Per the rule in §2, it is not pinned to a room: it
follows them between eras and grows.

**Visibility is `acquired <= room.date`.** This is not a new rule — it is §5's
lifespan rule pointed at a different object. In the 1983 room you see
everything you have collected; step back into 1980 and the later disks are
absent, because in 1980 you did not have them yet. No time travel, and no
special case anyone codes.

Visibility keys off `acquired` rather than `released`, because owning a 1977
disk you were given in 1982 is ordinary. `released` is text on the label.

`acquired` is an ISO date for dated media, and the literal `"undated"` for an
upload whose year the visitor did not supply (§6.6). The comparator is defined
for both: `"undated"` is visible in every room, and every other value is
compared as `acquired <= room.date`. There is no third case and no default.

**Rooms declare a starter set.** `room.starterMedia` is the curated exhibit,
and entering a room for the first time puts those disks in the box, dated to
that room. The 1980 room supplies a DOS 3.3 System Master and some blanks;
entering 1983 later adds what an owner would have bought since. The box fills
the way a real one did.

### 6.3 The drives

Drives are declared by the machine in room data, never assumed:

```ts
interface DriveSpec { slot: number; drive: number; accepts: Medium["kind"][] }
interface Drive { spec: DriveSpec; loaded: Medium | null; doorOpen: boolean; motorOn: boolean }
```

The 1980 Apple II+ declares a Disk II controller in slot 6 with two drives. A
1977 machine declares a cassette port, and the same code paths serve it.

Insert and eject are physical: drag a disk from the box to the drive, the door
lever swings shut, the light comes on when the motor runs. There is no "load
image" menu anywhere in the room. **What is in a drive is machine state and it
persists** — leave a disk in overnight and it is still there tomorrow, which is
what everyone did.

**Swapping a disk while the motor runs is allowed, and it does what it did.**
We do not block it, warn about it, or quietly re-sync the image. The emulator
sees the swap and DOS reacts however DOS reacted.

**The write-protect notch is enforced honestly.** A covered notch fails the
write at the hardware level and DOS prints its own `I/O ERROR`. We never accept
a write and silently drop it. Writes to unprotected disks are saved back to the
box on a short debounce, so the curated exhibit cannot be damaged — a visitor
who wants to modify one copies it to a blank first, which is what `COPYA` on
the System Master was for.

### 6.4 Power-on, and the empty drive

**A machine powered on with an empty drive grinds.** The light comes on, the
head knocks, and nothing happens, forever. That is what a Disk II did with no
diskette in it, and it is the same wall every owner hit once.

To keep that reading as a broken 1980 rather than a broken website, the room
carries a museum card beside the machine — the same convention §4.1 already
establishes, so it costs no new idea:

> **APPLE II PLUS**, 1979. There is no software in the machine. Software came
> on diskettes; try the box.

That is a label on an exhibit, not a tooltip in a web app. The room survives.

### 6.5 Where diskettes are kept

**In the visitor's own browser**, in IndexedDB: one database, a `media` store
holding metadata and image bytes, and a `machines` store holding what is in
which drive. On first use we call `navigator.storage.persist()` so the browser
treats the data as worth keeping rather than as evictable cache.

That call has three outcomes and they are deliberately distinguished, because
conflating them is how a visitor loses an evening's work to something we said
nothing about:

- **Resolves `true`** — the data is exempt from eviction. Nothing to say.
- **Resolves `false`, or the API is absent** — storage works normally, but the
  browser may evict it under disk pressure. Writes proceed; the disk box
  carries a line saying these disks are not guaranteed to survive. This is
  **not** treated as storage being unavailable.
- **IndexedDB is unavailable, or throws** — the standing banner below. Never a
  silent in-memory fallback.

An Apple 5.25" image is 143,360 bytes, so a shelf of twenty disks is about
3 MB against a budget measured in hundreds. Capacity is not a concern.

This is also the thesis made literal: **the disks never leave the house.**
Nothing about the visitor's machine crosses the internet — only the phone call.

The limits are real and get disclosed rather than hidden. The box is tied to
one browser on one device; clearing site data erases it; a private window
discards it on close. §6.6 exists because of that.

If IndexedDB is unavailable or blocked, we do **not** quietly fall back to
memory and let a visitor lose an evening's work. A standing banner says so
plainly: *your browser is not storing site data; anything you save will be gone
when you close this tab.* Disclosed, never masked. A quota failure is a named
error, never a dropped write.

### 6.6 Arrival and departure

**Uploads.** A visitor drags a disk image onto the box. Format and size are
checked against the `kind` — a 5.25" Apple disk is 143,360 bytes, a `.woz` is
checked by header — and anything unidentifiable is rejected by name and reason
rather than half-loaded. The visitor then **writes the label**: the text and a
year, because that is what you did with a disk somebody handed you. Undated
disks are visible in every room and marked as undated.

**Uploads are never sent to us in the course of being stored or used** — an
uploaded disk goes from the visitor's machine into their own browser and stays
there.

The one path by which disk bytes cross our infrastructure is a transfer
(§6.7), where the exchange relays them between two visitors. There we **retain
nothing**: disk contents are never written to logs, never persisted, and exist
in the relay only as the buffer needed to pass them along. The exchange is a
switchboard, and a switchboard does not keep the call.

So we host only what we curated and can defend.

**Export**, in two forms, both of them the visitor's to keep:

- **The whole box** as one file — a zip of `manifest.json` plus the images.
  This is the answer to a cleared browser, and it is how a box moves to another
  device.
- **A single disk** as its raw `.dsk` or `.woz`, which opens in any Apple II
  emulator. No lock-in: you can walk away with your floppies.

### 6.7 Transfer is a phone call

Since no board of this era served files (§5.7), a disk moves the way it really
moved: **one visitor calls another.** Your machine has a phone number in the
room's exchange. Someone dials it, your Apple answers, both sides run their
comms software, and XMODEM carries the disk at 300 baud — about eighty minutes
for a full floppy, which people genuinely left running overnight.

The machinery is almost entirely machinery we already have. **To the exchange,
a visitor's machine is a destination with one line.** Same call setup, same
carrier handshake, same busy signal as CBBS, all of it described in §4.3. If
someone is already calling you, the next caller gets a busy signal, because you
have one phone line like everybody else. Same-era only, per §5.4.

We never hold the file: the bytes cross between two browsers through the
switchboard and land in the receiving box as `provenance: "received"`.

**This gates on comms software.** The Super Serial Card's firmware terminal
mode (§4.2) is enough to dial and read a board, but not to transfer a file.
Transfer needs a real terminal program with XMODEM on an Apple diskette, and
which one we can source and defensibly host is an open question — see §12.

## 7. The room's physical interface

Everything in §4 through §6 concerns what the room contains. This section
concerns what it is like to sit at it.

### 7.1 Sound

Sound is content, and it is held to §4.4's standard: sourced where it can be,
labelled honestly where it cannot.

**The call.** Every tone in a 1980 phone call is a specified frequency, so
these are generated exactly rather than approximated:

| | Composition | Cadence |
|---|---|---|
| Dial tone | 350 + 440 Hz | continuous |
| Ringback | 440 + 480 Hz | 2s on, 4s off |
| Busy | 480 + 620 Hz | 0.5s on, 0.5s off |
| Bell 103 answer | 2225 Hz | steady, on answer |

**The busy signal deserves particular care.** §1 calls it the defining
experience of going online in 1980, and it is the sound the project is
organised around. It should be exact, and it should come out of the handset.

**A 300-baud connection does not screech.** The warbling handshake everyone
remembers is V.32/V.34, from a decade later. Bell 103 is two modems holding
steady tones at each other. This is the single most likely anachronism to creep
in by instinct, and getting it right is worth more than any other sound here.

**The call goes silent once it connects.** This is the part most people
actually remember, and it is easy to get wrong by building a soundtrack. The
visitor flips the modem to DATA and puts the handset back on the cradle, which
cuts the audio path — and the rest of the call is silent. Later modems muted
their speaker at carrier detect for the same reason. **The sound stopping is
how you know you are connected.**

The 300-baud FSK burble is therefore audible only in the seconds between the
carrier appearing and the handset going down. Dawdle before flipping to DATA
and you hear the data; hang up and it cuts. It is a window, not a bed.

**The machine.** The Disk II head recalibration knock on boot — the drive
banging the head against its stop — then motor whirr and seek chatter. The
Apple's own speaker, which the emulator already produces.

**And near-silence otherwise.** The Apple II+ has no fan; Woz's switching
supply was one of the machine's quiet triumphs. The room's only other sound is
the monitor's flyback whine. Adding a fan hum would be a comfortable, wrong
instinct.

Recorded drive sounds carry a *reconstruction* label unless sourced from a
real machine. Generated Bell and Western Electric tones are exact and say so.

### 7.2 The keyboard

**The Apple II+ has no lowercase.** The keyboard could not produce it, so
typing `hello` sends `HELLO`. This is silent and immediate — the screen shows
the truth on the first keystroke, and no explanation is needed.

The real software already expects this. CBBS asks every caller at login:

> `CAN YOUR TERMINAL DISPLAY LOWER CASE CHARACTERS, Y/N:`

— `cbbsfunc.asm:222`. A visitor on the Apple II+ answers `N` and the board
adapts, exactly as a 1980 caller would. The 1981 software handles the 1980
hardware without any help from us.

The visitor's keyboard maps to the II+ matrix. Keys the machine did not have do
nothing at all; we never substitute a plausible alternative, because a key that
silently does something else is the room lying.

**`RESET` is live, and it reboots.** It is placed as an on-screen key rather
than bound to anything a browser might send, so nobody loses a session to a
stray keystroke — but pressing it does what it did, with no confirmation.

### 7.3 The telephone

The signature interaction of the project, and until now a single line of spec.

The telephone is an object: handset, rotary dial, and the modem beside it. A
call is a sequence of physical acts, each taking the time it took.

1. **Lift the handset** — dial tone
2. **Dial** — ten pulses per second, one pulse per digit, and about 700ms
   between digits. A `0` alone takes a full second. This is not padding; it is
   why phone numbers felt long
3. **Listen** — ringback, or a busy signal, or nothing at all if the far end
   is down (§10)
4. **The far end answers** — the 2225 Hz carrier appears in the handset
5. **Flip the modem to DATA**, and replace the handset — **the audio cuts**
6. **Connected**, and silent. Bytes flow at 300 baud (§4.3)

Hanging up is the reverse: the modem to VOICE, or lifting and replacing the
handset, and carrier drops.

**The phone's behaviour is driven by the modem, which is room data** (§2). The
1980 Apple II+ carries a Micromodem II, which is direct-connect — there are no
handset cups to wrestle with. A room whose machine has an acoustic coupler gets
that interaction instead, and a 1981+ Hayes Smartmodem dials itself and removes
steps 1 through 5 entirely. The telephone UI reads the modem spec; it never
assumes one.

### 7.4 The manuals

The 1980 answer to "how do I use this" was a shelf of binders, and that is the
help system: period documentation as an object in the room, readable in place.

For the board we already hold the sources — `cookbook.txt`, `cbbsoper.txt`,
and `1981cbbslist.txt` as the phone book. For the machine, the Apple II
Reference Manual and the DOS 3.3 manual are the natural companions, subject to
the same hosting question as curated software (§12).

No tooltips, no modal walkthrough, no coach marks. A visitor who wants to know
what `CATALOG` does looks it up, which is what everyone did. The museum cards
of §4.1 and §6.4 remain the one non-diegetic affordance, and they explain the
room rather than the interface.

### 7.5 Duration is content

**Nothing is fast-forwarded.** DOS 3.3 takes its seconds to boot. `INIT` takes
about twenty. A rotary `0` takes a full second. A disk at 300 baud takes eighty
minutes. §4.3 already insists that 300 baud must *feel* like 300 baud; this
generalises that to everything else, because the waiting is the experience and
someone will otherwise eventually optimise it away as a defect.

There is no skip button. The one accommodation is practical rather than
aesthetic: a machine keeps running while its tab is in the background, so an
eighty-minute transfer does not require watching it. Browsers throttle
background timers aggressively, and making this work is a real constraint on
the emulator's timing loop rather than a detail (§12).

## 8. Data flow: one phone call

1. Visitor opens the room page and switches on the Apple II+. The empty Disk II
   grinds (§6.4)
2. Visitor takes the system diskette from the box, puts it in drive 1 and
   reboots; DOS 3.3 comes up and leaves them at `]`
3. Visitor looks up CBBS in the phone book and dials it on the on-screen phone
4. The browser opens a WebSocket to the exchange and requests that number
5. The exchange checks CBBS's line count
   - **Occupied:** returns a busy signal, audible and visible. Call over.
   - **Free:** reserves the line, returns ring, then CBBS answers
6. Carrier handshake; the visitor flips the modem to DATA
7. Bytes now flow: Apple's SSC → serial hub → WebSocket → exchange → CBBS's
   emulated serial port, and back, paced at 300 baud
8. Visitor reads and posts messages. Posts persist to CBBS's emulated disk.
9. Hangup, or carrier loss, releases the line for the next caller

## 9. Historical fidelity

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

## 10. Error handling

Failures are era-appropriate wherever possible, and honest otherwise.

- **Destination full** → busy signal. Not an error; the intended experience.
- **Destination host down** → the phone rings and rings, unanswered.
- **WebSocket drops** → carrier loss. The Apple sees exactly what it would
  have seen in 1980.
- **CBBS host crashes** → the exchange reports the number as out of service,
  and an operator alert fires. Never a silent failure.
- **Emulator fails to start** → an explicit page-level error naming the cause.
  No blank screen, no fake terminal.
- **Empty drive at power-on** → it grinds. Not an error; the intended
  experience, with a museum card explaining the room rather than the bug.
- **Unreadable disk image** → a named page-level error saying which disk and
  why. Never a silently empty drive.
- **Write to a protected disk** → the write fails at the hardware level and DOS
  prints its own `I/O ERROR`. Never accepted and dropped.
- **Browser storage blocked or unavailable** → a standing banner saying nothing
  will be kept. Never a silent in-memory fallback.
- **Rejected upload** → named by reason. Never half-loaded.

Per project convention: no fallbacks that mask failure, no stubs standing in
for the real destination, no placeholder data.

## 11. Testing

- **Exchange state machine** — unit tests for dial, ring, answer, busy,
  connect, hangup, carrier loss, line accounting
- **Concurrency** — two clients, one line: the second must receive busy
- **Baud pacing** — verify 300 baud delivers ~30 characters per second
- **CBBS build reproducibility** — assembling the archived source yields a
  working binary; this is the gate on the "real software" claim
- **End-to-end** — a headless client dials CBBS through the exchange and
  asserts the real login sequence appears
- **Persistence** — a posted message survives a host restart
- **Cross-era messages** — a message written in the 1980 room is visible in the
  1983 room; a message written in 1983 is absent from 1980
- **Era visibility** — a disk acquired in 1983 is absent from the 1980 room,
  and present in 1983; an `"undated"` disk is present in both
- **Write protection** — a write to a notched disk fails and the stored image
  is byte-identical afterwards
- **Storage round-trip** — a formatted disk survives a reload; a blocked
  IndexedDB raises the banner rather than silently running in memory
- **Export/import** — a box round-trips byte-for-byte, and an exported single
  disk is a valid image outside this project
- **Transfer** — two visitors move a disk by XMODEM; a third caller gets busy
- **Uppercase** — typing `hello` at the Apple II+ delivers `HELLO` to the board
- **Call tones** — dial tone, ringback and busy match their specified
  frequencies and cadences (§7.1), and the answer tone is a steady 2225 Hz
- **Background tabs** — a transfer in progress continues at correct speed with
  the tab hidden

## 12. Risks and open questions

1. **CBBS clock card.** CBBS wants a Scitronics or CompuTime clock. Whether
   the chosen S-100 emulator can present one, or whether the clock code needs
   stubbing, is unresolved. Stubbing a clock is acceptable; stubbing message
   handling is not.
2. **Outboard-modem path.** *Reduced, 2026-09-09.* Reading the source shows the
   path is a supported assembly-time option, not an improvisation: `CBBS.ASM`
   carries `SERMODM EQU FALSE` alongside `PMMI`, `HAYES` and `IDS`, and
   `CBBSSUB3.ASM` links `CBBSMODM.ASM` when it is true. `CBBSMODM.ASM` names the
   hardware exactly — a 6850 ACIA at ports 4/5, and a control port with
   carrier-in, ring-in and off-hook-out bits. It remains unproven end to end by
   us, but it is no longer an unknown quantity.
3. **Assembling 1981 source.** *Reduced, 2026-09-09.* `LINKASM.COM` ships on
   disk 1 as Intel HEX alongside `LOAD.SUB`, so the toolchain travels with the
   source. Running it still requires a working CP/M, which is the spike's job.
4. **CBBS 3.5 vs the 1980 target year.** Accepted and disclosed.
5. **Hosting.** Undecided. The exchange and CBBS host are long-lived
   processes, which rules out purely serverless hosting for those components.
6. **Comms software for transfer.** §6.7 needs a real Apple II terminal program
   with XMODEM, from 1980 or earlier, that we can source and defensibly host.
   None identified yet. Dialling and reading a board do not depend on this;
   transferring disks does.
7. **The apple2ts disk seam.** The serial seam was verified by reading the code.
   The insert/eject and write-back seam has *not* been, and §6.3 assumes it is
   as clean. Verify before committing to an estimate.
8. **Phones, tablets and accessibility.** Deferred deliberately, not overlooked.
   An Apple II is nothing but keyboard, and a device without one cannot use this
   room; forty columns of uppercase text behind a CRT shader is also hard to
   read before considering low vision. These are obligations of being a public
   website rather than authenticity questions, and they deserve their own design
   pass before launch — not a hurried subsection here.
9. **Background-tab throttling.** §7.5 requires a machine to keep running at
   correct speed while its tab is hidden, or an eighty-minute transfer becomes
   impossible in practice. Browsers throttle timers in background tabs
   aggressively. Unverified against apple2ts's timing loop.
10. **Manual and documentation hosting.** §7.4 puts the Apple II Reference
   Manual and the DOS 3.3 manual in the room. Same hosting question as curated
   software, and unresolved for the same reason.
11. **Curating the 1980 box.** Choosing real, datable software we are comfortable
   hosting is most of what makes the room good, and it is unstarted. Visitor
   uploads (§6.6) reduce the pressure but do not remove it — a visitor arriving
   to an empty room has nothing to do.

## 13. Future rooms

Sketched only, to keep the engine honest — not commitments:

- **1977, the Trinity year** — Apple II, PET 2001, TRS-80 Model I at launch.
  Cassette tape, 4–16K, no disks, and *no destinations at all*. It is also the
  check on §6: `kind: "cassette"` must carry the whole room, and if the media
  model has quietly become diskette-shaped, this is where that shows. The room's
  point is isolation: the machines cannot talk to anything, including each
  other. This is a useful check on the model in §5: the 1977 room's emptiness
  is not a special case anyone codes: CBBS opens in February 1978, so the
  lifespan rule produces an empty phone book on its own.
- **1983** — Commodore 64, 1200 baud, a crowded BBS scene, ANSI art.
- **1981** — the boundary. The IBM PC arrives in August, and the Hayes
  Smartmodem makes the phone dial itself.

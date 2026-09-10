# Decisions

Strategic decisions and pivots, with the reasoning that produced them.

## 2026-09-09 — Rooms pin what you can reach, not what you own

**Decision.** Era rooms stay discrete, but a visitor's disk box is private,
accumulates across eras, and follows them between rooms.

**Why.** Freezing a disk box at one year is not authenticity — people owned
these machines for years and their boxes filled up. But making the year a free
dial would scatter visitors across time so that two people are never on CBBS at
once, and the busy signal is the single best thing in this project.

The axis turned out to be **simultaneity, not sharing**. Phone lines are
contended in the moment and must be pinned to an era. Message bases and disk
boxes accumulate, and are filtered by date instead. See spec §2.

## 2026-09-09 — Disks move by phone call, not by download

**Decision.** Visitors transfer disks to each other over the emulated telephone
using XMODEM. There is no file library on any board.

**Why.** CBBS has no file transfer of any kind — verified across all thirty
`.ASM` files. Adding it would mean modifying CBBS and forfeiting the *real
software* claim that gates the project.

The period-correct answer is better anyway: in 1980 you did not download a disk
from a board, you called the other person and both ran `MODEM.ASM`. That is
precisely what Christensen wrote XMODEM for in 1977. It also means we never
hold the file. See spec §5.7 and §6.7.

## 2026-09-09 — The telephone line is the CP/M machine's console

**Decision.** The emulated S-100 machine's *console* is the phone line. We do
not attach a second emulated serial card for the modem.

**Why.** Discovered while building the spike. CBBS does not drive the ACIA
directly for terminal I/O: `TYPE` in `cbbssub2.asm` calls an address patched in
at startup — the CP/M BIOS `CONOUT` vector — and `KEYIN` goes through `CONST`.
The `SERLCTL`/`SERLDAT` equates in `cbbsmodm.asm` are used only by `CONNECT` to
initialise the card.

That is how the original worked: on Randy Suess's machine the modem *was* the
system console, which is what the shipped `BIOSCON.ASM` is for. Attaching a
separate serial port would have been less faithful, not more.

Carrier, ring and off-hook remain real hardware bits on I/O port `0FFH`, exactly
as `cbbsmodm.asm` reads them.

## 2026-09-09 — The message base is built per room, and filtered by date

**Decision.** Each room's CBBS disk image is built containing only messages
dated on or before that room's date.

**Why.** The archived CBBS message base runs from February 1978 to December
1981. The 1980 room must not show a 1981 post — spec §5.3 forbids time travel —
and CBBS itself will not filter, because it has no idea what year the room
thinks it is.

Filtering at image-build time keeps CBBS unmodified and makes the timeline a
property of the disk, which is where it lived in reality.

## 2026-09-10 — The modem screech is the 1990s one, on purpose

**Decision.** The connect sound is a V.32bis/V.34-style handshake, not the Bell
103 carrier a 1980 call actually produced.

**Why.** Bell 103 had nothing to negotiate — both ends knew they were 300 baud,
so the answering modem parked on a steady 2225 Hz tone, the originating modem
joined at 1270 Hz, and that was it. The famous screech is a 1990s modem
*discovering what the line can carry*: echo-canceller disable, spectral probing,
rate negotiation, training, then data that sounds like white noise.

The authentic version is correct and nobody recognises it. A visitor who has
never heard a 300-baud call hears two steady tones and concludes nothing is
happening. The screech is what says "a modem is connecting" to the people this
room is for.

So this is the one place the room knowingly prefers a familiar lie to an
unfamiliar truth. It is disclosed in the anachronism register (§9) rather than
smuggled in, and everything around it stays honest — the call-progress tones are
the real Western Electric frequencies, the line really runs at 300 baud, and the
sound still stops dead at connect, which the 1990s modems also did.

## 2026-09-10 — Everything runs on one host

**Decision.** The room page, the Apple II emulator and the telephone exchange
are served by a single process on one machine, behind one Cloudflare tunnel.
Nothing is on a CDN or a serverless platform.

**Why.** The interesting half of this project cannot be serverless. A call is a
WebSocket held open for as long as the visitor stays on the board. The busy
signal is in-memory state — the exchange knows CBBS's one line is taken because
it is one process that remembers, and spread across functions there is no
"taken". And the message base is a disk image that must survive between
callers, written by a compiled emulator holding FIFOs.

The static half could have gone to a CDN, and briefly the plan was to split it.
Splitting bought a faster first paint for a page nobody is waiting on, and cost
a second deploy target, a cross-origin WebSocket, and an exchange URL to keep
in sync. Serving both from one origin means the page dials the host that served
it and there is nothing to configure.

## 2026-09-10 — Mothballed here, deliberately

**Decision.** Work stopped with Plan A complete and Plan B two tasks in.

**Why.** Recorded so the next person does not mistake the stopping point for a
natural seam. It is not one: the machines can dial a bulletin board but have
nothing to put in the drive, because the media subsystem is Plan B. An Apple II
with an empty drive and no box of diskettes is a machine you can only make one
phone call from.

The next task is Plan B task 3, the drive. The seam it needs is verified and
recorded in the plan: `passSetDriveNewData` puts a disk in, `doSetUIDriveProps`
reports when the Apple writes, and `DriveProps` already carries
`isWriteProtected` and `diskHasChanges` — so the write-protect notch and the
write-back are the emulator's own behaviour rather than something to simulate.

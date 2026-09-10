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

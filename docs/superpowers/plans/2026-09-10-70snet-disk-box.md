# 70snet Plan B — The Disk Box

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor has a box of diskettes beside their Apple II+. They can put
one in the drive, boot it, save to it, format a blank one, bring in a disk of
their own, take their box with them, and send a disk to another visitor down
the telephone line.

**Architecture:** Media is a data model shared by the room and the emulator.
Disk images live in the visitor's own browser (IndexedDB) and never reach our
server. The emulator is driven through the seam `apple2ts` already provides —
`passSetDriveNewData` to insert, `doSetUIDriveProps` to hear about writes.
Transfer reuses the exchange: a visitor's machine is a destination with one
line, so a disk crosses as an ordinary phone call.

**Tech Stack:** TypeScript (strict), IndexedDB, `apple2ts` drive API, the
exchange and switchboard from Plan A.

**Spec:** `docs/superpowers/specs/2026-09-09-70snet-1980-computer-room-design.md` §6

**Depends on:** Plan A, merged. The room, the telephone, the exchange, the
switchboard and the CBBS host all exist and are green.

## Global Constraints

- **The visitor's disks never reach our server.** Uploads go from their machine
  into their own browser. The only path across our infrastructure is a transfer
  (§6.7), where the exchange relays bytes and retains nothing — not in logs,
  not persisted, only the buffer needed to pass them along.
- **Media, not diskettes.** The model is generic over `diskette-5.25`,
  `diskette-8`, `cassette` and `cartridge`, because §13's 1977 room is
  cassette-only and a diskette-shaped abstraction will not survive it.
- **Visibility is `acquired <= room.date`,** with the literal `"undated"`
  visible in every room. This is §5's lifespan rule pointed at a possession.
- **The write-protect notch is real.** A covered notch fails the write at the
  hardware level and DOS prints its own `I/O ERROR`. We never accept a write
  and silently drop it.
- **No silent in-memory fallback.** If IndexedDB is unavailable, a standing
  banner says so in plain words. A `persist()` result of `false` is NOT the
  same as storage being unavailable — see §6.5's three outcomes.
- **TypeScript strict.** No masking: no `|| ""`, `?? {}`, empty `catch {}`, or
  placeholder returns.

## The apple2ts seam (verified 2026-09-10)

Insertion and write-back both already exist; we add no emulator internals.

| Direction | Function | Module |
|---|---|---|
| insert a disk | `passSetDriveNewData(props: DriveProps)` | `src/ui/main2worker.ts` |
| insert, with ack | `requestSetDriveNewData(props, forceIndex, timeoutMs)` | same |
| hear about writes | `doSetUIDriveProps(props, replaceDiskData)` | `src/ui/devices/disk/driveprops` |

`DriveProps` carries what §6.3 needs: `diskData: Uint8Array`,
`isWriteProtected`, `diskHasChanges`, `lastAppleWriteTime`, `motorRunning`,
`drive`, `filename`.

## File Structure

```
packages/media/                  the model, pure and testable
  src/medium.ts                  Medium, kinds, formats, the honesty label
  src/box.ts                     the visitor's box: add, remove, era filter
  src/format.ts                  image validation by kind and header

packages/storage/                the visitor's own browser
  src/db.ts                      IndexedDB: media and machine state
  src/persistence.ts             persist() three outcomes, the banner contract

apps/web/src/
  diskbox.ts                     the box as an object on the desk
  drive.ts                       insert, eject, the notch, write-back
  transfer.ts                    sending a disk down the line

packages/protocol/src/
  xmodem.ts                      the 1977 protocol, both ends
```

---

## Task 1: Media, and the box

**Files:**
- Create: `packages/media/src/medium.ts`, `src/box.ts`, `src/format.ts`
- Test: `packages/media/src/box.test.ts`, `src/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Medium`, `MediumKind`, `Box`, `visibleIn(box, roomDate): Medium[]`,
  `addToBox(box, medium): Box`, `validateImage(bytes, kind): void`.

- [ ] **Step 1: Write the failing era-visibility test**

```ts
import { describe, it, expect } from "vitest"
import { visibleIn } from "./box"
import type { Medium } from "./medium"

const disk = (id: string, acquired: string): Medium => ({
  id, kind: "diskette-5.25", format: "dsk", label: id,
  acquired, writeProtected: false, provenance: "curated",
})

describe("what the visitor can see", () => {
  it("shows only what they owned by the room's date", () => {
    const box = [disk("dos33", "1980-08-01"), disk("later", "1983-06-01")]
    expect(visibleIn(box, "1980-10-01").map(m => m.id)).toEqual(["dos33"])
  })

  it("shows everything by a later room's date", () => {
    const box = [disk("dos33", "1980-08-01"), disk("later", "1983-06-01")]
    expect(visibleIn(box, "1983-06-01").map(m => m.id)).toEqual(["dos33", "later"])
  })

  it("shows an undated upload in every room", () => {
    // The visitor did not tell us the year, so it cannot be filtered by one.
    const box = [disk("mystery", "undated")]
    expect(visibleIn(box, "1977-06-01")).toHaveLength(1)
    expect(visibleIn(box, "1983-06-01")).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/media`
Expected: FAIL — cannot resolve `./box`.

- [ ] **Step 3: Implement the model**

`medium.ts` is spec §6.1 verbatim, with `acquired: string | "undated"`.
`box.ts` implements the comparator with no third case and no default:

```ts
export function visibleIn(box: Box, roomDate: string): Medium[] {
  return box.filter(m => m.acquired === "undated" || m.acquired <= roomDate)
}
```

- [ ] **Step 4: Validate images by kind**

`format.ts`. A 5.25" Apple disk is exactly 143,360 bytes; `.woz` is checked by
its `WOZ1`/`WOZ2` header. Anything unidentifiable throws a named error saying
which check failed — never a half-loaded disk.

- [ ] **Step 5: Run the tests, then commit**

Run: `pnpm vitest run packages/media` → PASS

---

## Task 2: The visitor's own browser

**Files:**
- Create: `packages/storage/src/db.ts`, `src/persistence.ts`
- Test: `packages/storage/src/persistence.test.ts`

**Interfaces:**
- Produces: `openBox(): Promise<BoxStore>` with `list()`, `put(medium)`,
  `remove(id)`, `readImage(id)`, `writeImage(id, bytes)`; and
  `describeDurability(): Promise<Durability>` returning one of
  `"persistent" | "evictable" | "unavailable"`.

- [ ] **Step 1: Write the failing durability test**

The three outcomes of §6.5 are the point of this task, so test them directly
with an injected `StorageManager`:

```ts
it("persist() resolving false is NOT storage being unavailable", async () => {
  const d = await describeDurability({ persist: async () => false, estimate: async () => ({}) })
  expect(d).toBe("evictable")
})

it("a missing storage API is still usable, just evictable", async () => {
  expect(await describeDurability(undefined)).toBe("evictable")
})

it("reports unavailable when IndexedDB itself throws", async () => {
  expect(await describeDurability(throwingManager)).toBe("unavailable")
})
```

- [ ] **Step 2: Run it, confirm it fails, implement, run again**

`"evictable"` must drive a line on the disk box, and `"unavailable"` the
standing banner. Neither may silently fall back to memory.

---

## Task 3: The drive

**Files:**
- Create: `apps/web/src/drive.ts`
- Test: `apps/web/src/drive.test.ts`

**Interfaces:**
- Consumes: `Medium` (Task 1), the box store (Task 2), and the apple2ts seam.
- Produces: `insert(drive, medium)`, `eject(drive)`, `onDiskChanged(cb)`.

- [ ] **Step 1: Insert a disk**

Build a `DriveProps` from the `Medium` and hand it to `passSetDriveNewData`.
`isWriteProtected` comes from the medium's notch — this is where §6.3's
"enforced honestly" actually happens, and DOS produces its own `I/O ERROR`
without us inventing one.

- [ ] **Step 2: Hear about writes and save them**

Subscribe to `doSetUIDriveProps`. When `diskHasChanges` is true and the medium
is not write-protected, write the image back to the box on a short debounce.
A write-protected medium is never written — assert this in a test.

- [ ] **Step 3: What is in the drive persists**

Machine state (which medium is in which drive) is stored alongside the media,
so a disk left in overnight is still there tomorrow. Test the round trip.

---

## Task 4: The box as an object on the desk

**Files:**
- Create: `apps/web/src/diskbox.ts`
- Test: `apps/web/src/diskbox.test.ts`

Renders the box in the desk view (see Plan A's room/desk split): a period
flip-top box of sleeved diskettes, each with its hand-lettered label and its
honesty card. Drag a disk to the drive to insert; the door lever closes; the
light comes on when the motor runs. Eject returns it to the box.

Swapping while the motor runs is allowed and does what it did. We do not block
it, warn about it, or quietly re-sync the image.

---

## Task 5: Bringing a disk in

**Files:**
- Modify: `apps/web/src/diskbox.ts`
- Test: `apps/web/src/upload.test.ts`

Drag an image onto the box. Validate by kind (Task 1), reject anything
unidentifiable by name and reason. The visitor then writes the label — text and
a year — because that is what you did with a disk somebody handed you. Undated
disks are marked as such and visible in every room.

---

## Task 6: Taking the box with you

**Files:**
- Create: `apps/web/src/boxfile.ts`
- Test: `packages/media/src/boxfile.test.ts`

Two exports, both the visitor's to keep:

- the whole box as one file — a zip of `manifest.json` plus the images
- a single disk as its raw `.dsk`/`.woz`, which opens in any Apple II emulator

Import round-trips a box byte-for-byte. Test that explicitly: a box exported
and re-imported must be identical, or the escape hatch is a lie.

---

## Task 7: Sending a disk down the line

**Files:**
- Create: `packages/protocol/src/xmodem.ts`
- Create: `apps/web/src/transfer.ts`
- Test: `packages/protocol/src/xmodem.test.ts`

XMODEM as Christensen wrote it in 1977: 128-byte blocks, block number and its
complement, checksum, `SOH`/`ACK`/`NAK`/`EOT`. Implement both ends and test
them against each other, including a corrupted block being NAK'd and resent.

To the exchange, **a visitor's machine is a destination with one line** (spec
§6.7). Same call setup, same busy signal, same carrier as CBBS — all of it
already built in Plan A. Register the visitor's machine in the destination
registry when they are online; the second caller gets a busy signal because
they have one phone line like everybody else.

Same-era only, per §5.4.

---

## Task 8: What is in the box to begin with

**Files:**
- Create: `packages/registry/src/data/media.ts`
- Modify: `packages/registry/src/data/rooms.ts` (`starterMedia`)

The curated exhibit. Choosing real, datable software we are comfortable hosting
is most of what makes the room good, and it is unstarted (spec §12.11).

Each entry carries its honesty label and its date. Start with what is
defensible and already vendored:

- `CBBS PHONE LIST` — the real `1981cbbslist.txt`, *reconstruction*
- a blank, hand-lettered diskette the visitor can `INIT`

Then extend deliberately. **This task is a research pass as much as a coding
one:** for each candidate, record what it is, when it was released, and why we
believe we may host it. Anything we cannot answer for does not go in the box.

---

## Done when

- A visitor can put a disk in, boot it, save to it, and find it there tomorrow
- A write-protected disk fails the write the way DOS did
- Clearing browser data loses the box, and the visitor was told it would
- A box exported and re-imported is byte-for-byte identical
- Two visitors move a disk between them, and a third caller gets a busy signal
- The 1977 room shows a cassette and no diskettes, from data alone

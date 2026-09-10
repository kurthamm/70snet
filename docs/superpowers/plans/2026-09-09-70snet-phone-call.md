# 70snet Plan A — The Phone Call

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor opens the 1980 room, switches on an Apple II+, dials CBBS on
an on-screen telephone, and reads and posts messages on the real 1978 bulletin
board — getting a real busy signal when someone else is already on the line.

**Architecture:** Three processes. The visitor's Apple II+ runs entirely in their
browser (`apple2ts`, forked to add a WebSocket serial backend). CBBS runs as real
8080 assembly on an emulated S-100 CP/M machine (`z80pack/cpmsim`) supervised by a
Node process. Between them sits the telephone exchange — the only component built
from nothing — which owns call setup, per-destination line counts, and 300-baud
pacing. Bytes cross as opaque octets; nothing in the path understands CBBS.

**Tech Stack:** TypeScript (strict), Node 24, pnpm workspaces, vitest, `ws`,
z80pack (C), CBBS 3.5 (8080 assembly).

**Spec:** `docs/superpowers/specs/2026-09-09-70snet-1980-computer-room-design.md`

**Scope:** This plan delivers §3's phone call. The disk box, media, uploads and
disk transfer (spec §6) are **Plan B** and are deliberately out of scope here —
except that §6.4's grinding empty drive is built in Task 9, because the room is
dishonest without it.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this
section.

- **Node >= 24, npm >= 11.** `apple2ts` declares these in `engines`. The dev
  machine currently has Node 22 — Task 2 Step 1 fails fast on this.
- **TypeScript strict mode.** No `any` in exported signatures.
- **No masking.** Per the project's fail-fast rules: no `|| ""`, `?? {}`, empty
  `catch {}`, placeholder returns, or stubbed integrations. Missing config fails
  immediately with a named error.
- **Room date for v1:** `1980-10-01` (fall 1980).
- **CBBS line count: 1.** Everyone else gets a busy signal (spec §5.6).
- **300 baud is 30 characters per second** — 8N1, 10 bits per character,
  33.333ms per byte. Duration is content; nothing is fast-forwarded (spec §7.5).
- **Call tone frequencies** (spec §7.1), exact, generated not sampled:
  dial tone 350+440 Hz continuous; ringback 440+480 Hz at 2s on / 4s off;
  busy 480+620 Hz at 0.5s on / 0.5s off; Bell 103 answer tone 2225 Hz steady.
- **A 300-baud connection does not screech.** Steady tones only. The V.32 warble
  is a decade later and is the most likely anachronism to creep in.
- **CBBS assembly-time configuration** (verified in the source 2026-09-09):
  `SERMODM EQU TRUE`, `PMMI EQU FALSE`, `HAYES EQU FALSE`, `IDS EQU FALSE`.
- **CBBS hardware expectations** (from `cbbsmodm.asm`): 6850 ACIA control port 4,
  data port 5, status bit 0 = RDRF, bit 1 = TDRE; init bytes `03H` then `15H`.
  Modem control port `0FFH`: input bit `40H` = **not**-carrier (active low),
  bit `20H` = **not**-ring; output bit `10H` = off-hook.
- **Uppercase only.** The Apple II+ keyboard cannot produce lowercase (spec §7.2).

## File Structure

```
machines/s100-cbbs/        the CBBS host machine
  vendor/z80pack/          submodule, pinned
  patches/phone-port.diff  the one C change: I/O port 0FFH
  cbbs/                    CBBS 3.5 source, vendored from bbsdocumentary
  build.sh                 assembles CBBS under CP/M, produces CBBS.COM
  run.sh                   boots the machine
  verify.sh                the "real software" gate (spec §11)

packages/protocol/         wire types shared by every process
  src/line.ts              LineFrame codec (exchange <-> host)
  src/client.ts            ClientMessage/ServerMessage (browser <-> exchange)
  src/pacer.ts             BaudPacer — 300 baud as real time

packages/registry/         rooms and destinations as data (spec §2, §5)
  src/destination.ts       Destination, DestinationEra, eraFor, phoneBook
  src/room.ts              Room, MachineSpec
  src/data/destinations.ts CBBS, and the era table
  src/data/rooms.ts        the 1980 room, and a 1977 room used as a test fixture

packages/exchange/         the switchboard — the original work (spec §4.3)
  src/exchange.ts          call state machine and line accounting
  src/line.ts              LineInterface — what a destination must implement

packages/cbbs-host/        supervises the emulated S-100 machine
  src/host.ts              CbbsHost implements LineInterface

apps/switchboard/          the server process
  src/server.ts            ws server binding browser clients to the exchange

apps/web/                  the room page
  src/room.ts              the 1980 room, rendered from registry data
  src/telephone.ts         the phone: rotary timing, handset, DATA switch
  src/tones.ts             dial/ringback/busy/carrier via WebAudio

vendor/apple2ts/           our fork — one added serial backend
```

Files that change together live together: the phone's sound lives beside the
phone, not in a global `audio/`. The exchange knows nothing about CBBS, and
`cbbs-host` knows nothing about WebSockets.

---

## Task 1: CBBS assembled, booted, and answering (the spike)

This is first because it carries the project's three deepest unknowns, and
because §11 makes "assembling the archived source yields a working binary" the
gate on the *real software* claim. If this fails, it fails before any
surrounding code exists.

**Files:**
- Create: `machines/s100-cbbs/cbbs/` (vendored source)
- Create: `machines/s100-cbbs/patches/phone-port.diff`
- Create: `machines/s100-cbbs/build.sh`, `run.sh`, `verify.sh`
- Create: `machines/s100-cbbs/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a bootable machine directory, and `verify.sh` exiting 0 when CBBS
  prints its banner over the serial port. Task 6 wraps this; nothing else
  depends on its internals.

- [ ] **Step 1: Vendor the CBBS 3.5 source**

```bash
mkdir -p machines/s100-cbbs/cbbs && cd machines/s100-cbbs/cbbs
BASE=http://software.bbsdocumentary.com/AAA/AAA/CBBS
curl -sSfO $BASE/cbbs35_disk1.zip
curl -sSfO $BASE/cbbs35_disk2.zip
curl -sSfO $BASE/1981cbbslist.txt      # the in-room phone book, spec §4.4
curl -sSfO $BASE/cookbook.txt          # installation guide, spec §7.4
curl -sSfO $BASE/cbbsoper.txt          # operator's manual, spec §7.4
unzip -o cbbs35_disk1.zip && unzip -o cbbs35_disk2.zip
sha256sum *.zip > SOURCES.sha256
```

Expected: `cbbs.asm`, `cbbsmodm.asm`, `cbbssub3.asm`, `linkasm.com.hex` and
`load.sub` present. `linkasm.com.hex` is the period assembler — the toolchain
ships with the source, which is why spec §12.3 is marked *reduced*.

- [ ] **Step 2: Add z80pack as a pinned submodule and build it**

```bash
git submodule add https://github.com/udo-munk/z80pack machines/s100-cbbs/vendor/z80pack
cd machines/s100-cbbs/vendor/z80pack/cpmsim/srcsim && make -j4
ls -la ../cpmsim
```

Expected: `cpmsim` binary built, no errors. Its I/O map already places the
auxiliary serial port at **ports 4 and 5** — exactly where `cbbsmodm.asm`
expects the ACIA — and it exposes that port as the FIFOs
`/tmp/.z80pack/cpmsim.auxin` and `cpmsim.auxout`.

- [ ] **Step 3: Write the failing verification script**

`machines/s100-cbbs/verify.sh`:

```bash
#!/usr/bin/env bash
# The "real software" gate (spec §11). Boots CBBS and asserts its banner.
set -euo pipefail
cd "$(dirname "$0")"
AUXIN=/tmp/.z80pack/cpmsim.auxin
AUXOUT=/tmp/.z80pack/cpmsim.auxout

./run.sh &
SIM=$!
trap 'kill $SIM 2>/dev/null || true' EXIT
timeout 30 bash -c "
  until [ -p $AUXIN ] && [ -p $AUXOUT ]; do sleep 0.2; done
  printf '\r' > $AUXIN          # CBBS waits for a CR to detect speed
  head -c 400 $AUXOUT
" > /tmp/cbbs-banner.txt

grep -qi 'CBBS' /tmp/cbbs-banner.txt || { echo "FAIL: no CBBS banner"; cat /tmp/cbbs-banner.txt; exit 1; }
echo "PASS: CBBS answered"
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `chmod +x machines/s100-cbbs/verify.sh && machines/s100-cbbs/verify.sh`
Expected: FAIL — `run.sh` does not exist yet.

- [ ] **Step 5: Patch cpmsim with the modem control port**

CBBS reads carrier and ring from port `0FFH` and writes off-hook to it. `cpmsim`
leaves that port unimplemented (unused ports return `FF`, which reads as *no
carrier* — correct as a default, useless as a phone).

For the spike, carrier is hardwired present. Task 6 makes it dynamic. Add to
`vendor/z80pack/cpmsim/srcsim/simio.c`:

```c
/* 70snet: modem control port 0FFH (see cbbsmodm.asm).
   Bits are active low: 40H = NOT carrier, 20H = NOT ring indicator.
   Output bit 10H = off hook. */
static BYTE phone_status = 0xFF & ~0x40;   /* carrier present, not ringing */
static BYTE phone_in(void) { return phone_status; }
static void phone_out(BYTE data) { UNUSED(data); }
```

and register it in the two dispatch tables:

```c
in_func_t *const port_in[256] = { ... [255] = phone_in, ... };
out_func_t *const port_out[256] = { ... [255] = phone_out, ... };
```

Add the forward declaration beside the others, then capture the change so it is
reproducible rather than a local edit:

```bash
cd machines/s100-cbbs/vendor/z80pack && git diff > ../../patches/phone-port.diff
cd cpmsim/srcsim && make -j4
```

- [ ] **Step 6: Assemble CBBS under CP/M**

`machines/s100-cbbs/build.sh` puts the source on a CP/M disk, runs the period
assembler, and extracts the result.

Getting host files onto a CP/M image needs `cpmtools`. **This is a package
install and requires the user's approval** — ask before running it:

```bash
sudo apt-get install -y cpmtools     # ASK FIRST
```

Then:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
Z=vendor/z80pack/cpmsim

# a scratch drive B holding the source
cp $Z/disks/library/cpm22-2.dsk $Z/disks/driveb.dsk
for f in cbbs/*.asm cbbs/load.sub; do
  cpmcp -f ibm-3740 $Z/disks/driveb.dsk "$f" 0:
done

# LINKASM ships as Intel HEX; LOAD turns it into a .COM under CP/M
cpmcp -f ibm-3740 $Z/disks/driveb.dsk cbbs/linkasm.com.hex 0:LINKASM.HEX

# CBBS.ASM must select the outboard modem (spec §12.2)
sed -i 's/^PMMI\tEQU\tTRUE/PMMI\tEQU\tFALSE/;  s/^SERMODM\tEQU\tFALSE/SERMODM\tEQU\tTRUE/' cbbs/cbbs.asm
```

Expected after assembly: `CBBS.COM` on drive B. `LINKASM` follows the `LINK`
pseudo-op at the end of each file, so assembling `CBBS.ASM` pulls the whole
chain — and `CBBSSUB3.ASM` links `CBBSMODM.ASM` only when `SERMODM` is true.

- [ ] **Step 7: Write run.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
Z=vendor/z80pack/cpmsim
rm -f $Z/disks/drivea.dsk $Z/disks/driveb.dsk
ln $Z/disks/library/cpm22-1.dsk $Z/disks/drivea.dsk
ln disks/cbbs-drive-b.dsk $Z/disks/driveb.dsk
cd $Z && exec ./cpmsim
```

- [ ] **Step 8: Run the verification**

Run: `machines/s100-cbbs/verify.sh`
Expected: PASS, and `/tmp/cbbs-banner.txt` contains the CBBS sign-on.

If it fails, the failure is the spike's product. Record which of spec §12.1–3
was wrong in `machines/s100-cbbs/README.md` and stop — do not work around it,
and do not stub CBBS.

- [ ] **Step 9: Resolve the clock card (spec §12.1)**

`cbbs.asm` has `CLOCKS EQU TRUE` (Scitronics). `cpmsim` has a clock at ports
25/26, which is not that card. Two honest options, in order of preference:

1. Set `CLOCKC EQU FALSE` and `CLOCKS EQU FALSE`, and let CBBS run clockless.
2. Implement the Scitronics port so CBBS reads the *in-fiction* date — which is
   the better answer, because CBBS then date-stamps its own messages and spec
   §5.3's timeline comes from the real software rather than from us.

Take option 1 here to unblock the spike. **Option 2 is Task 7 and is not
optional** — spec §3 requires date-stamping in v1 because it cannot be
retrofitted. Stubbing a clock is acceptable temporarily (spec §12.1); stubbing
message handling never is.

- [ ] **Step 10: Commit**

```bash
git add machines/s100-cbbs .gitmodules
git commit -m "Assemble and boot CBBS 3.5 on an emulated S-100 CP/M machine

Vendors the CBBS 3.5 source from Jason Scott's BBS Software Directory and
assembles it with the period LINKASM that ships alongside it. Adds the modem
control port at 0FFH that cbbsmodm.asm expects. verify.sh is the real-software
gate from spec §11."
```

---

## Task 2: Workspace, and the line protocol

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`
- Create: `packages/protocol/src/line.ts`, `packages/protocol/src/client.ts`
- Test: `packages/protocol/src/line.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LineFrame`, `encodeFrame(f: LineFrame): Uint8Array`,
  `decodeFrames(buf: Uint8Array): { frames: LineFrame[]; rest: Uint8Array }`,
  and the `ClientMessage`/`ServerMessage` unions. Tasks 5, 6, 7 and 8 all
  depend on these exact names.

- [ ] **Step 1: Fail fast on the Node version**

```bash
node -e 'const [maj]=process.versions.node.split(".").map(Number); if (maj < 24) { console.error(`Node ${process.versions.node} < 24; apple2ts requires >=24`); process.exit(1) }'
```

Expected on the current dev machine: FAIL. Install Node 24 (`nvm install 24 && nvm use 24`) and re-run until it passes. Do not lower the requirement.

- [ ] **Step 2: Create the workspace**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json`:

```json
{
  "name": "70snet",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`tsconfig.json` — the root project, needed for `pnpm typecheck` (`tsc -b`) to
resolve anything. Add one `references` entry per package as later tasks create
them; it starts with just `protocol`:

```json
{
  "files": [],
  "references": [{ "path": "packages/protocol" }]
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "skipLibCheck": true
  }
}
```

Run: `pnpm install`

- [ ] **Step 3: Give every package a manifest**

Each workspace package needs its own `package.json` for the `@70snet/*`
imports used throughout this plan to resolve. For each of `protocol`,
`registry`, `exchange`, `cbbs-host` (under `packages/`) and `switchboard`,
`web` (under `apps/`):

```json
{
  "name": "@70snet/protocol",
  "private": true,
  "type": "module",
  "exports": { "./*": "./src/*.ts" }
}
```

Substitute the name per package. The subpath export is what makes
`@70snet/registry/data/destinations` resolve.

- [ ] **Step 4: Write the failing codec test**

`packages/protocol/src/line.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { encodeFrame, decodeFrames, type LineFrame } from "./line"

describe("line frame codec", () => {
  it("round-trips a data frame", () => {
    const f: LineFrame = { type: "data", bytes: new Uint8Array([0x48, 0x49]) }
    const { frames, rest } = decodeFrames(encodeFrame(f))
    expect(frames).toEqual([f])
    expect(rest.length).toBe(0)
  })

  it("round-trips signalling frames", () => {
    const fs: LineFrame[] = [
      { type: "ring" },
      { type: "carrier", on: true },
      { type: "carrier", on: false },
      { type: "offhook", on: true },
    ]
    const buf = new Uint8Array(fs.flatMap(f => [...encodeFrame(f)]))
    expect(decodeFrames(buf).frames).toEqual(fs)
  })

  it("returns a partial trailing frame as rest, not a guess", () => {
    const whole = encodeFrame({ type: "data", bytes: new Uint8Array([1, 2, 3]) })
    const { frames, rest } = decodeFrames(whole.slice(0, whole.length - 1))
    expect(frames).toEqual([])
    expect(rest.length).toBe(whole.length - 1)
  })

  it("throws on an unknown frame type rather than skipping it", () => {
    expect(() => decodeFrames(new Uint8Array([0x7f, 0x00, 0x00])))
      .toThrow(/unknown line frame type 0x7f/)
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm vitest run packages/protocol`
Expected: FAIL — cannot resolve `./line`.

- [ ] **Step 6: Implement the codec**

`packages/protocol/src/line.ts`:

```ts
/** One event on a telephone line. Data frames carry opaque octets: nothing in
 *  the path understands what CBBS is saying. */
export type LineFrame =
  | { type: "data"; bytes: Uint8Array }
  | { type: "ring" }
  | { type: "carrier"; on: boolean }
  | { type: "offhook"; on: boolean }

const DATA = 0x01
const RING = 0x02
const CARRIER = 0x03
const OFFHOOK = 0x04

const HEADER = 3 // type u8 + length u16be

export function encodeFrame(frame: LineFrame): Uint8Array {
  const payload =
    frame.type === "data" ? frame.bytes
    : frame.type === "ring" ? new Uint8Array(0)
    : new Uint8Array([frame.on ? 1 : 0])

  const type =
    frame.type === "data" ? DATA
    : frame.type === "ring" ? RING
    : frame.type === "carrier" ? CARRIER
    : OFFHOOK

  const out = new Uint8Array(HEADER + payload.length)
  out[0] = type
  out[1] = (payload.length >> 8) & 0xff
  out[2] = payload.length & 0xff
  out.set(payload, HEADER)
  return out
}

export function decodeFrames(buf: Uint8Array): { frames: LineFrame[]; rest: Uint8Array } {
  const frames: LineFrame[] = []
  let i = 0

  while (i + HEADER <= buf.length) {
    const type = buf[i]!
    const len = (buf[i + 1]! << 8) | buf[i + 2]!
    if (i + HEADER + len > buf.length) break // partial; wait for more

    const payload = buf.subarray(i + HEADER, i + HEADER + len)
    switch (type) {
      case DATA: frames.push({ type: "data", bytes: new Uint8Array(payload) }); break
      case RING: frames.push({ type: "ring" }); break
      case CARRIER: frames.push({ type: "carrier", on: payload[0] === 1 }); break
      case OFFHOOK: frames.push({ type: "offhook", on: payload[0] === 1 }); break
      default:
        throw new Error(`unknown line frame type 0x${type.toString(16)}`)
    }
    i += HEADER + len
  }

  return { frames, rest: buf.subarray(i) }
}
```

- [ ] **Step 7: Run the test**

Run: `pnpm vitest run packages/protocol`
Expected: PASS, 4 tests.

- [ ] **Step 8: Add the client protocol**

`packages/protocol/src/client.ts`:

```ts
/** Browser -> exchange. Control only; modem bytes travel as binary frames. */
export type ClientMessage =
  | { kind: "dial"; number: string }
  | { kind: "hangup" }

/** Exchange -> browser. Every outcome a 1980 caller could hear. */
export type ServerMessage =
  | { kind: "ringing" }
  | { kind: "busy" }
  | { kind: "no-answer" }
  | { kind: "connected"; baud: number }
  | { kind: "carrier-lost" }
  | { kind: "out-of-service"; reason: string }
```

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json packages/protocol
git commit -m "feat(protocol): line frame codec and client message types"
```

---

## Task 3: 300 baud as real time

Spec §4.3 requires that 300 baud *feel* like 300 baud, and §7.5 generalises
that: duration is content. This is the component that makes it true.

**Files:**
- Create: `packages/protocol/src/pacer.ts`
- Test: `packages/protocol/src/pacer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class BaudPacer` with `constructor(bitsPerSecond: number, bitsPerChar: number, sink: (b: Uint8Array) => void)`, `push(bytes: Uint8Array): void`, `stop(): void`, and `readonly pending: number`. Tasks 5 and 7 use it.

- [ ] **Step 1: Write the failing test**

`packages/protocol/src/pacer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BaudPacer } from "./pacer"

describe("BaudPacer", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("delivers 30 characters per second at 300 baud, 8N1", () => {
    const got: number[] = []
    const p = new BaudPacer(300, 10, b => got.push(...b))
    p.push(new Uint8Array(60).fill(0x41))

    vi.advanceTimersByTime(1000)
    expect(got.length).toBe(30)

    vi.advanceTimersByTime(1000)
    expect(got.length).toBe(60)
  })

  it("delivers nothing before the first character time has elapsed", () => {
    const got: number[] = []
    const p = new BaudPacer(300, 10, b => got.push(...b))
    p.push(new Uint8Array([0x41]))

    vi.advanceTimersByTime(33)
    expect(got.length).toBe(0)
    vi.advanceTimersByTime(1)
    expect(got.length).toBe(1)
  })

  it("preserves order across separate pushes", () => {
    const got: number[] = []
    const p = new BaudPacer(300, 10, b => got.push(...b))
    p.push(new Uint8Array([1, 2]))
    vi.advanceTimersByTime(34)
    p.push(new Uint8Array([3]))
    vi.advanceTimersByTime(1000)
    expect(got).toEqual([1, 2, 3])
  })

  it("stop() discards pending bytes — a dropped carrier loses them", () => {
    const got: number[] = []
    const p = new BaudPacer(300, 10, b => got.push(...b))
    p.push(new Uint8Array(30))
    vi.advanceTimersByTime(100)
    const delivered = got.length
    p.stop()
    vi.advanceTimersByTime(5000)
    expect(got.length).toBe(delivered)
    expect(p.pending).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/protocol/src/pacer.test.ts`
Expected: FAIL — cannot resolve `./pacer`.

- [ ] **Step 3: Implement**

**Do not use `setInterval` with a fractional delay.** 300 baud at 10 bits per
character is 33.333ms, and both Node and vitest's fake timers truncate a
fractional delay to whole milliseconds — so `setInterval(fn, 33.333)` fires its
first tick at 33ms, failing the test above, and then drifts steadily out of true
300-baud timing. Over the eighty-minute transfer §7.5 describes, that drift is
minutes. Pre-dividing into a float is also unsafe: `30 * (10 * 1000 / 300)`
evaluates to `1000.0000000000001`.

Schedule each character against its own cumulative deadline instead, computed
from integer numerator and denominator:

```ts
private deadline(n: number): number {
  return Math.ceil((n * this.msNumerator) / this.bitsPerSecond)
}
```

where `msNumerator = bitsPerChar * 1000`. Each timeout is
`deadline(n) - deadline(n - 1)`, so rounding never accumulates.

`packages/protocol/src/pacer.ts`:

```ts
/** Releases bytes at a fixed line speed, one character at a time.
 *
 *  300 baud with 8N1 framing is 10 bits per character, so 30 characters per
 *  second — 33.333ms each. The waiting is the point (spec §7.5); do not batch
 *  and do not "catch up" after a stall. */
export class BaudPacer {
  private queue: number[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  // Deadlines are computed as ceil((n * msNumerator) / bitsPerSecond) rather
  // than from a pre-divided "ms per char" float. A fixed fractional interval
  // (e.g. 300 baud, 10 bits/char = 33.333...ms) cannot be handed to
  // setInterval/setTimeout directly: both Node and fake timers truncate a
  // fractional delay to whole milliseconds, so a naive setInterval(fn,
  // 33.333) fires its first tick at 33ms, not 34ms, and then drifts out of
  // sync with true 300-baud timing over a long run. Keeping the numerator and
  // denominator separate (instead of pre-dividing into a float) also avoids
  // floating-point rounding error compounding across many characters — e.g.
  // 30 * (10*1000/300) rounds to slightly over 1000 in IEEE 754, which would
  // push the 30th character's deadline to 1001ms instead of the true 1000.
  private readonly msNumerator: number
  private readonly bitsPerSecond: number
  // Count of characters whose delivery has been scheduled in the current run.
  private charsScheduled = 0

  constructor(
    bitsPerSecond: number,
    bitsPerChar: number,
    private readonly sink: (bytes: Uint8Array) => void,
  ) {
    if (bitsPerSecond <= 0) throw new Error(`bitsPerSecond must be positive, got ${bitsPerSecond}`)
    if (bitsPerChar <= 0) throw new Error(`bitsPerChar must be positive, got ${bitsPerChar}`)
    this.bitsPerSecond = bitsPerSecond
    this.msNumerator = bitsPerChar * 1000
  }

  get pending(): number {
    return this.queue.length
  }

  push(bytes: Uint8Array): void {
    for (const b of bytes) this.queue.push(b)
    this.ensureRunning()
  }

  stop(): void {
    this.queue.length = 0
    this.charsScheduled = 0
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private ensureRunning(): void {
    if (this.timer !== null) return
    this.charsScheduled = 0
    this.scheduleNext()
  }

  private deadline(n: number): number {
    return Math.ceil((n * this.msNumerator) / this.bitsPerSecond)
  }

  private scheduleNext(): void {
    const n = this.charsScheduled + 1
    const delay = this.deadline(n) - this.deadline(n - 1)

    this.timer = setTimeout(() => {
      this.timer = null
      const b = this.queue.shift()
      if (b === undefined) {
        this.charsScheduled = 0
        return
      }
      this.charsScheduled = n
      this.sink(new Uint8Array([b]))
      if (this.queue.length > 0) this.scheduleNext()
    }, delay)
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run packages/protocol/src/pacer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/pacer.ts packages/protocol/src/pacer.test.ts
git commit -m "feat(protocol): BaudPacer — 300 baud delivered as real time"
```

---

## Task 4: Rooms and destinations as data

Spec §2 forbids hardcoding a room, and §5 puts destinations in their own
registry keyed by year. This task builds both, and proves the model with a 1977
room whose phone book is empty *without anyone coding emptiness*.

**Files:**
- Create: `packages/registry/src/destination.ts`, `src/room.ts`
- Create: `packages/registry/src/data/destinations.ts`, `src/data/rooms.ts`
- Test: `packages/registry/src/destination.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Destination`, `DestinationEra`, `Room`, `MachineSpec`,
  `eraFor(d, date): DestinationEra | null`, `eraKeyFor(d, date): string | null`,
  `phoneBook(ds, date): PhoneBookEntry[]`, and the constants `ROOM_1980`,
  `CBBS`. Task 5 depends on `eraFor` and `eraKeyFor`; Task 9 on `phoneBook`.

- [ ] **Step 1: Write the failing test**

`packages/registry/src/destination.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { eraFor, eraKeyFor, phoneBook } from "./destination"
import { CBBS, DESTINATIONS } from "./data/destinations"
import { ROOM_1980, ROOM_1977 } from "./data/rooms"

describe("destination eras", () => {
  it("resolves the era alive in a given year", () => {
    const era = eraFor(CBBS, ROOM_1980.date)
    expect(era?.lines).toBe(1)
    expect(era?.speeds).toEqual([300])
  })

  it("returns null before the destination existed", () => {
    expect(eraFor(CBBS, "1977-06-01")).toBeNull()
  })

  it("keys occupancy by destination AND era, per spec 5.5", () => {
    const k1980 = eraKeyFor(CBBS, "1980-10-01")
    const k1983 = eraKeyFor(CBBS, "1983-06-01")
    expect(k1980).not.toBeNull()
    expect(k1980).not.toEqual(k1983)
  })

  it("the 1977 room has an empty phone book with no special case", () => {
    // CBBS opens February 1978. Nothing in the code says "1977 is empty";
    // the lifespan rule produces it. Spec 13.
    expect(phoneBook(DESTINATIONS, ROOM_1977.date)).toEqual([])
  })

  it("the 1980 room reaches CBBS", () => {
    const book = phoneBook(DESTINATIONS, ROOM_1980.date)
    expect(book.map(e => e.name)).toContain("CBBS")
    expect(book[0]!.fidelity).toBe("real-software")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/registry`
Expected: FAIL — cannot resolve `./destination`.

- [ ] **Step 3: Implement the types and lookups**

`packages/registry/src/destination.ts`:

```ts
/** A destination's presentation and capacity in one slice of time. Services
 *  changed across the era (spec 5.2), so this is versioned, not fixed. */
export interface DestinationEra {
  from: string            // ISO date, inclusive
  until: string           // ISO date, inclusive
  lines: number           // simultaneous callers the real service had (spec 5.6)
  speeds: number[]        // baud rates available in this era
  access: "direct-dial" | "telenet" | "tymnet"
  presentationName: string
  fidelity: "real-software" | "reconstruction"
  host: string            // host id the exchange resolves to a LineInterface
}

export interface Destination {
  id: string
  number: string
  name: string
  eras: DestinationEra[]
}

export interface PhoneBookEntry {
  name: string
  number: string
  fidelity: DestinationEra["fidelity"]
  speeds: number[]
}

export function eraFor(d: Destination, date: string): DestinationEra | null {
  return d.eras.find(e => e.from <= date && date <= e.until) ?? null
}

/** Occupancy is per destination-era, never global: a busy CBBS in 1980 does
 *  not block a caller in 1983, because those are different points on the
 *  timeline (spec 5.5). */
export function eraKeyFor(d: Destination, date: string): string | null {
  const i = d.eras.findIndex(e => e.from <= date && date <= e.until)
  return i === -1 ? null : `${d.id}@${i}`
}

export function phoneBook(ds: Destination[], date: string): PhoneBookEntry[] {
  const out: PhoneBookEntry[] = []
  for (const d of ds) {
    const era = eraFor(d, date)
    if (era === null) continue
    out.push({ name: d.name, number: d.number, fidelity: era.fidelity, speeds: era.speeds })
  }
  return out
}
```

- [ ] **Step 4: Add the data**

`packages/registry/src/data/destinations.ts`:

```ts
import type { Destination } from "../destination"

/** CBBS, Chicago. One phone line, from February 1978 into the mid-1980s.
 *  Everyone else gets a busy signal — spec 5.6. */
export const CBBS: Destination = {
  id: "cbbs",
  name: "CBBS",
  number: "312-545-8086",
  eras: [
    {
      from: "1978-02-16",
      until: "1982-12-31",
      lines: 1,
      speeds: [300],
      access: "direct-dial",
      presentationName: "CBBS/Chicago",
      fidelity: "real-software",
      host: "cbbs-host",
    },
    {
      from: "1983-01-01",
      until: "1986-12-31",
      lines: 1,
      speeds: [300, 1200],
      access: "direct-dial",
      presentationName: "CBBS/Chicago",
      fidelity: "real-software",
      host: "cbbs-host",
    },
  ],
}

export const DESTINATIONS: Destination[] = [CBBS]
```

`packages/registry/src/room.ts`:

```ts
export interface MachineSpec {
  id: string
  name: string
  emulator: "apple2ts"
  /** Museum card text shown beside the machine (spec 4.1, 6.4). */
  card: string
  modem: { id: string; name: string; dialing: "manual" | "hayes-at"; speeds: number[] }
  drives: { slot: number; drive: number }[]
}

export interface Room {
  id: string
  name: string
  /** The room's in-fiction date. Governs what can be reached, never what the
   *  visitor owns (spec 2). */
  date: string
  machines: MachineSpec[]
}
```

`packages/registry/src/data/rooms.ts`:

```ts
import type { Room } from "../room"

export const ROOM_1980: Room = {
  id: "1980",
  name: "Fall 1980",
  date: "1980-10-01",
  machines: [
    {
      id: "apple2plus",
      name: "Apple II Plus",
      emulator: "apple2ts",
      card:
        "APPLE II PLUS, 1979. There is no software in the machine. " +
        "Software came on diskettes; try the box.",
      modem: {
        id: "micromodem2",
        name: "Micromodem II",
        dialing: "manual",
        speeds: [300],
      },
      drives: [
        { slot: 6, drive: 1 },
        { slot: 6, drive: 2 },
      ],
    },
  ],
}

/** Not shipped. A fixture proving the engine, per spec 13: the 1977 room's
 *  empty phone book must fall out of the lifespan rule, not a special case. */
export const ROOM_1977: Room = {
  id: "1977",
  name: "The Trinity Year",
  date: "1977-06-01",
  machines: [],
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run packages/registry`
Expected: PASS, 5 tests. The 1977 emptiness test is the one that matters — it
proves the engine, not the room.

- [ ] **Step 6: Commit**

```bash
git add packages/registry
git commit -m "feat(registry): destinations with eras, rooms as data

The 1977 room's empty phone book falls out of the lifespan rule rather than
any special case, which is the check spec 13 asks for."
```

---

## Task 5: The exchange

The only component built from nothing, and where the project's character lives.

**Files:**
- Create: `packages/exchange/src/line.ts`, `packages/exchange/src/exchange.ts`
- Test: `packages/exchange/src/exchange.test.ts`

**Interfaces:**
- Consumes: `Destination`, `eraFor`, `eraKeyFor` (Task 4).
- Produces: `interface LineInterface`, `interface HostRegistry`, `type DialOutcome`, and `class Exchange` with `dial(callerId, roomDate, number): Promise<DialOutcome>`, `hangup(callerId): void`, `occupancy(eraKey): number`. Tasks 6 and 7 implement and drive these.

- [ ] **Step 1: Define what a destination must provide**

`packages/exchange/src/line.ts`:

```ts
/** What the exchange requires of anything reachable by telephone — a CP/M
 *  machine, or in Plan B another visitor's Apple. The exchange never learns
 *  which; bytes are opaque octets. */
export interface LineInterface {
  /** Seize and ring. Resolves when the far end answers with carrier.
   *  Rejects if it never answers. */
  ring(signal: AbortSignal): Promise<void>
  /** Caller -> destination. */
  send(bytes: Uint8Array): void
  /** Destination -> caller. */
  onData(cb: (bytes: Uint8Array) => void): void
  /** Release the line. Must be safe to call twice. */
  hangup(): void
  /** The destination died mid-call, or could not be reached at all. */
  onFailure(cb: (err: Error) => void): void
}

export interface HostRegistry {
  get(hostId: string): LineInterface | undefined
}
```

- [ ] **Step 2: Write the failing test**

`packages/exchange/src/exchange.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { Exchange } from "./exchange"
import type { LineInterface, HostRegistry } from "./line"
import { CBBS, DESTINATIONS } from "@70snet/registry/data/destinations"

const D = "1980-10-01"

function fakeLine(over: Partial<LineInterface> = {}): LineInterface {
  return {
    ring: vi.fn(async () => {}),
    send: vi.fn(),
    onData: vi.fn(),
    hangup: vi.fn(),
    onFailure: vi.fn(),
    ...over,
  }
}

function hosts(line: LineInterface): HostRegistry {
  return { get: id => (id === "cbbs-host" ? line : undefined) }
}

describe("Exchange", () => {
  it("connects a caller to a free destination", async () => {
    const x = new Exchange({ destinations: DESTINATIONS, hosts: hosts(fakeLine()) })
    const r = await x.dial("alice", D, CBBS.number)
    expect(r.outcome).toBe("connected")
  })

  it("returns busy when the only line is taken", async () => {
    // The whole project in one test. CBBS had one phone line (spec 5.6).
    const x = new Exchange({ destinations: DESTINATIONS, hosts: hosts(fakeLine()) })
    await x.dial("alice", D, CBBS.number)
    const r = await x.dial("bob", D, CBBS.number)
    expect(r.outcome).toBe("busy")
  })

  it("frees the line on hangup", async () => {
    const x = new Exchange({ destinations: DESTINATIONS, hosts: hosts(fakeLine()) })
    await x.dial("alice", D, CBBS.number)
    x.hangup("alice")
    const r = await x.dial("bob", D, CBBS.number)
    expect(r.outcome).toBe("connected")
  })

  it("does not contend across eras", async () => {
    // A busy CBBS in 1980 must not block a caller in 1983 (spec 5.5).
    const x = new Exchange({ destinations: DESTINATIONS, hosts: hosts(fakeLine()) })
    await x.dial("alice", "1980-10-01", CBBS.number)
    const r = await x.dial("bob", "1983-06-01", CBBS.number)
    expect(r.outcome).toBe("connected")
  })

  it("rings unanswered for a number with no destination alive", async () => {
    const x = new Exchange({ destinations: DESTINATIONS, hosts: hosts(fakeLine()) })
    const r = await x.dial("alice", "1977-06-01", CBBS.number)
    expect(r.outcome).toBe("no-answer")
  })

  it("releases the line when the far end never answers", async () => {
    const line = fakeLine({ ring: vi.fn(async () => { throw new Error("no answer") }) })
    const x = new Exchange({ destinations: DESTINATIONS, hosts: hosts(line) })
    const first = await x.dial("alice", D, CBBS.number)
    expect(first.outcome).toBe("no-answer")
    expect(x.occupancy("cbbs@0")).toBe(0)
  })

  it("reports a missing host as out of service rather than pretending", async () => {
    const x = new Exchange({ destinations: DESTINATIONS, hosts: { get: () => undefined } })
    const r = await x.dial("alice", D, CBBS.number)
    expect(r.outcome).toBe("out-of-service")
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run packages/exchange`
Expected: FAIL — cannot resolve `./exchange`.

- [ ] **Step 4: Implement**

`packages/exchange/src/exchange.ts`:

```ts
import { eraFor, eraKeyFor, type Destination } from "@70snet/registry/destination"
import type { HostRegistry, LineInterface } from "./line"

export type DialOutcome =
  | { outcome: "busy" }
  | { outcome: "no-answer" }
  | { outcome: "out-of-service"; reason: string }
  | { outcome: "connected"; eraKey: string; baud: number; line: LineInterface }

interface Call {
  eraKey: string
  line: LineInterface
  abort: AbortController
}

export class Exchange {
  private readonly destinations: Destination[]
  private readonly hosts: HostRegistry
  private readonly calls = new Map<string, Call>()
  private readonly busyLines = new Map<string, number>()

  constructor(opts: { destinations: Destination[]; hosts: HostRegistry }) {
    this.destinations = opts.destinations
    this.hosts = opts.hosts
  }

  occupancy(eraKey: string): number {
    return this.busyLines.get(eraKey) ?? 0
  }

  async dial(callerId: string, roomDate: string, number: string): Promise<DialOutcome> {
    if (this.calls.has(callerId)) {
      throw new Error(`caller ${callerId} is already on a call`)
    }

    const dest = this.destinations.find(d => d.number === number)
    if (dest === undefined) return { outcome: "no-answer" }

    const era = eraFor(dest, roomDate)
    const eraKey = eraKeyFor(dest, roomDate)
    // Not alive in this year: the number simply rings, forever.
    if (era === null || eraKey === null) return { outcome: "no-answer" }

    if (this.occupancy(eraKey) >= era.lines) return { outcome: "busy" }

    const line = this.hosts.get(era.host)
    if (line === undefined) {
      return { outcome: "out-of-service", reason: `no host registered for "${era.host}"` }
    }

    // Seize the line before ringing, so a concurrent dial sees it taken.
    this.busyLines.set(eraKey, this.occupancy(eraKey) + 1)

    const abort = new AbortController()
    try {
      await line.ring(abort.signal)
    } catch {
      this.release(eraKey)
      return { outcome: "no-answer" }
    }

    const baud = era.speeds[0]
    if (baud === undefined) {
      this.release(eraKey)
      throw new Error(`destination ${dest.id} era has no line speed`)
    }

    this.calls.set(callerId, { eraKey, line, abort })
    return { outcome: "connected", eraKey, baud, line }
  }

  hangup(callerId: string): void {
    const call = this.calls.get(callerId)
    if (call === undefined) return
    this.calls.delete(callerId)
    call.abort.abort()
    call.line.hangup()
    this.release(call.eraKey)
  }

  private release(eraKey: string): void {
    const n = this.occupancy(eraKey)
    if (n <= 1) this.busyLines.delete(eraKey)
    else this.busyLines.set(eraKey, n - 1)
  }
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run packages/exchange`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/exchange
git commit -m "feat(exchange): call setup, per-destination-era line accounting

One line at CBBS means the second caller gets a busy signal. Occupancy is
keyed by destination and era so 1980 does not block 1983 (spec 5.5)."
```

---

## Task 6: The CBBS host adapter

**Superseded design, corrected 2026-09-09 during implementation.** This task
originally routed CBBS's bytes through `cpmsim`'s auxiliary FIFOs. That was
written before the spike found CBBS does its terminal I/O through the CP/M BIOS
console vectors — and the auxiliary device strips `\r` and `^Z`, which would
silently corrupt a modem stream. The emulator side is now built and committed:
the machine's *console* is the telephone line.

**The line interface the emulator presents** (all four are FIFOs in the
directory named by `SEVENTIESNET_LINE`):

| FIFO | Direction | Carries |
|---|---|---|
| `line.in` | supervisor → machine | caller's bytes, 8-bit clean |
| `line.out` | machine → supervisor | CBBS's bytes, 8-bit clean |
| `phone.in` | supervisor → machine | one byte of line state, read at port `0FFH` |
| `phone.out` | machine → supervisor | one byte per `OUT`, carrying off-hook |

Line-state bits are **active low**, per `cbbsmodm.asm`:
`0x40` = NOT carrier, `0x20` = NOT ring, `0x10` = off-hook (an output).
Idle is `0xFF`: no carrier, not ringing.

**Files:**
- Create: `packages/cbbs-host/src/host.ts`
- Test: `packages/cbbs-host/src/host.test.ts`

**Interfaces:**
- Consumes: `LineInterface` (Task 5).
- Produces: `class CbbsHost implements LineInterface`, constructed as
  `new CbbsHost({ machineDir, lineDir, inFictionDate })`, plus
  `start(): Promise<void>` and `stop(): Promise<void>`. Task 8 uses these.

- [ ] **Step 1: Understand the boot sequence, because the console is the line**

Since the console *is* the telephone line, CP/M's own prompt and the commands
that launch CBBS travel over `line.out` too. `start()` must therefore:

1. Spawn `run.sh` with `SEVENTIESNET_LINE` and `SEVENTIESNET_DATE` set.
2. Wait for the four FIFOs to exist, then open them.
3. Write `C:\r` then `CBBS\r` to `line.in` to launch the board.
4. Swallow everything up to that point — a caller must not receive CP/M noise.

CBBS then sits in `CONNECT` (`cbbsmodm.asm`) polling port `0FFH` for carrier.
It prints nothing until carrier appears, which is what makes this workable.

- [ ] **Step 2: Ring, and answer**

`ring()` writes the ring state, then carrier, to `phone.in`. CBBS's `CONNECT`
sees carrier and prints its banner, which is the first thing the caller hears.

- [ ] **Step 3: Hang up, and re-arm for the next caller**

`hangup()` writes `0xFF` — carrier drops, and CBBS sees loss of carrier and
exits to CP/M. The supervisor must then relaunch it with `CBBS\r` so the next
caller gets a fresh sign-on. CBBS 3.5 with `REINIT=FALSE` is reloaded per call,
exactly as the sysop's startup did; messages survive on the disk image, which
`persist.sh` proves.

- [ ] **Step 4: Verify**

`machines/s100-cbbs/verify.sh` and `persist.sh` already prove the machine end.
This task's own test asserts the Node adapter: that `ring()` produces the CBBS
banner on `onData`, and that after `hangup()` a second `ring()` produces a
fresh banner rather than a dead line.

---

## Task 7: The in-fiction clock, and messages that outlive a call

Spec §3 singles this out: date-stamping is built in v1 *even though v1 has one
room and one destination*, because retrofitting a timeline onto an accumulated
message base later would mean guessing at dates that were never recorded.
"Getting this wrong is not recoverable."

The good version costs little more than the stub. CBBS reads a clock card and
writes `MM/DD/YY` into every message itself (`cbbsclks.asm`, `RDDATE`). Feed it
the **room's** date and the real software date-stamps its own messages — spec
§5.3's timeline then comes from CBBS rather than from us.

**Files:**
- Modify: `machines/s100-cbbs/patches/phone-port.diff` (add the clock ports)
- Modify: `machines/s100-cbbs/cbbs/cbbs.asm` (`CLOCKS EQU TRUE`)
- Modify: `packages/cbbs-host/src/host.ts`
- Test: `packages/cbbs-host/src/persistence.test.ts`

**Interfaces:**
- Consumes: `CbbsHost` (Task 6), `ROOM_1980.date` (Task 4).
- Produces: `new CbbsHost({ machineDir, inFictionDate })` — the constructor
  gains a required `inFictionDate: string`. Task 8 passes `ROOM_1980.date`.

- [ ] **Step 1: Read the card's protocol out of the source**

```bash
sed -n '15,30p;165,225p' machines/s100-cbbs/cbbs/cbbsclks.asm
```

Expected, and verified 2026-09-09: the Scitronics board sits at **ports 24–27**
(`SCIP0 EQU 24`). `CLKINIT` probes port 24 to decide whether a clock exists,
and `RDDATE` reads BCD digits from it.

**Note the collision:** `cpmsim` already uses ports 25 and 26 for its own clock
and 27 for a timer. Implementing Scitronics means displacing those. That is
fine — CBBS is the only program running on this machine — but it must be done
deliberately rather than discovered later.

- [ ] **Step 2: Write the failing persistence test**

`packages/cbbs-host/src/persistence.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest"
import { CbbsHost } from "./host"
import { ROOM_1980 } from "@70snet/registry/data/rooms"

const MACHINE = new URL("../../../machines/s100-cbbs", import.meta.url).pathname

async function call(host: CbbsHost, keystrokes: string): Promise<string> {
  let out = ""
  host.onData(b => { out += String.fromCharCode(...b) })
  await host.ring(new AbortController().signal)
  for (const ch of keystrokes) {
    host.send(new Uint8Array([ch.charCodeAt(0)]))
    await new Promise(r => setTimeout(r, 120))
  }
  return out
}

describe("CBBS message base", () => {
  let host: CbbsHost | null = null
  afterEach(async () => { await host?.stop(); host = null })

  it("stamps messages with the room's date, not today's", async () => {
    host = new CbbsHost({ machineDir: MACHINE, inFictionDate: ROOM_1980.date })
    await host.start()
    const out = await call(host, "\r")
    // 1980-10-01 reaches CBBS as 10/01/80 via RDDATE.
    await vi.waitFor(() => expect(out).toMatch(/10\/01\/80/), { timeout: 30_000 })
  }, 90_000)

  it("a posted message survives a host restart", async () => {
    // Spec 11: persistence. The message base lives on the disk image, so
    // stopping and restarting the machine must not lose it.
    host = new CbbsHost({ machineDir: MACHINE, inFictionDate: ROOM_1980.date })
    await host.start()
    await call(host, "E\rTEST SUBJECT\rHELLO FROM 1980\r\r")
    host.hangup()
    await host.stop()

    host = new CbbsHost({ machineDir: MACHINE, inFictionDate: ROOM_1980.date })
    await host.start()
    const out = await call(host, "R\r")
    await vi.waitFor(() => expect(out).toContain("HELLO FROM 1980"), { timeout: 30_000 })
  }, 180_000)
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run packages/cbbs-host/src/persistence.test.ts`
Expected: FAIL — `inFictionDate` is not a constructor option.

- [ ] **Step 4: Implement the clock ports**

Add to the `simio.c` patch, alongside the phone port. The date comes from an
environment variable so the supervisor owns it and the machine stays dumb:

```c
/* 70snet: Scitronics clock board at ports 24-27 (see cbbsclks.asm).
   Displaces cpmsim's own clock, deliberately: CBBS is the only program here.
   The date is the ROOM's date, so CBBS date-stamps messages in-fiction. */
static BYTE clk_digits[6];      /* MMDDYY, BCD */
static int  clk_index = 0;

static void clk_load(void) {
    const char *d = getenv("SEVENTIESNET_DATE");   /* YYYY-MM-DD */
    if (d == NULL || strlen(d) != 10) {
        LOGE(TAG, "SEVENTIESNET_DATE unset or malformed; refusing to invent a date");
        exit(EXIT_FAILURE);
    }
    clk_digits[0] = d[5]; clk_digits[1] = d[6];    /* MM */
    clk_digits[2] = d[8]; clk_digits[3] = d[9];    /* DD */
    clk_digits[4] = d[2]; clk_digits[5] = d[3];    /* YY */
}
```

Note the fail-fast: an unset date **exits**, it does not default to today. A
silently-wrong date is exactly the unrecoverable outcome spec §3 warns about.

- [ ] **Step 5: Turn the clock on in CBBS**

```bash
sed -i 's/^CLOCKS\tEQU\tFALSE/CLOCKS\tEQU\tTRUE /' machines/s100-cbbs/cbbs/cbbs.asm
machines/s100-cbbs/build.sh
```

This supersedes Task 1 Step 9's temporary clockless build.

- [ ] **Step 6: Pass the date from the supervisor**

In `packages/cbbs-host/src/host.ts`, require the date and hand it to the machine:

```ts
constructor(private readonly opts: { machineDir: string; inFictionDate: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.inFictionDate)) {
    throw new Error(`inFictionDate must be YYYY-MM-DD, got "${opts.inFictionDate}"`)
  }
}
```

and in `start()`:

```ts
this.sim = spawn("./run.sh", {
  cwd: this.opts.machineDir,
  stdio: "pipe",
  env: { ...process.env, SEVENTIESNET_DATE: this.opts.inFictionDate },
})
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run packages/cbbs-host`
Expected: PASS. The restart test is slow by design — it boots the machine twice.

- [ ] **Step 8: Commit**

```bash
git add machines/s100-cbbs packages/cbbs-host
git commit -m "feat(cbbs-host): feed CBBS the room's date; messages persist

CBBS reads a Scitronics clock and stamps MM/DD/YY into every message itself,
so spec 5.3's timeline comes from the real software rather than from us. An
unset date exits rather than defaulting to today -- spec 3 calls a wrong date
unrecoverable."
```

---

## Task 8: The switchboard server, and the end-to-end call

**Files:**
- Create: `apps/switchboard/src/server.ts`, `apps/switchboard/src/main.ts`
- Test: `apps/switchboard/src/server.test.ts`

**Interfaces:**
- Consumes: `Exchange`, `CbbsHost`, `BaudPacer`, `ClientMessage`/`ServerMessage`.
- Produces: `createSwitchboard(opts): { port: number; close(): Promise<void> }`.
  Task 9's browser backend connects to it.

- [ ] **Step 1: Write the failing end-to-end test**

This is spec §11's end-to-end and concurrency gates in one file.

`apps/switchboard/src/server.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import WebSocket from "ws"
import { createSwitchboard } from "./server"
import { CBBS } from "@70snet/registry/data/destinations"

let sb: Awaited<ReturnType<typeof createSwitchboard>>

beforeAll(async () => { sb = await createSwitchboard({ port: 0 }) }, 60_000)
afterAll(async () => { await sb.close() })

function open(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${sb.port}`)
  return new Promise(res => ws.on("open", () => res(ws)))
}

function nextControl(ws: WebSocket): Promise<any> {
  return new Promise(res =>
    ws.once("message", (d, isBinary) => { if (!isBinary) res(JSON.parse(String(d))) }))
}

describe("switchboard", () => {
  it("a caller dials CBBS and sees the real login sequence", async () => {
    const ws = await open()
    ws.send(JSON.stringify({ kind: "dial", number: CBBS.number }))
    expect((await nextControl(ws)).kind).toBe("connected")

    ws.send(new Uint8Array([0x0d]))           // CR for speed detection
    let text = ""
    await new Promise<void>(res => {
      ws.on("message", (d, isBinary) => {
        if (!isBinary) return
        text += String.fromCharCode(...new Uint8Array(d as Buffer))
        if (text.toUpperCase().includes("CBBS")) res()
      })
    })
    expect(text.toUpperCase()).toContain("CBBS")
    ws.close()
  }, 90_000)

  it("the second caller gets a busy signal", async () => {
    const a = await open()
    a.send(JSON.stringify({ kind: "dial", number: CBBS.number }))
    expect((await nextControl(a)).kind).toBe("connected")

    const b = await open()
    b.send(JSON.stringify({ kind: "dial", number: CBBS.number }))
    expect((await nextControl(b)).kind).toBe("busy")

    a.close(); b.close()
  }, 90_000)

  it("delivers at 300 baud, not as fast as the socket allows", async () => {
    const ws = await open()
    ws.send(JSON.stringify({ kind: "dial", number: CBBS.number }))
    await nextControl(ws)

    const started = Date.now()
    let n = 0
    ws.send(new Uint8Array([0x0d]))
    await new Promise<void>(res => {
      ws.on("message", (d, isBinary) => {
        if (!isBinary) return
        n += (d as Buffer).length
        if (n >= 60) res()
      })
    })
    // 60 characters at 30 cps cannot arrive in under ~2 seconds.
    expect(Date.now() - started).toBeGreaterThan(1800)
    ws.close()
  }, 90_000)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/switchboard`
Expected: FAIL — cannot resolve `./server`.

- [ ] **Step 3: Implement the server**

`apps/switchboard/src/server.ts`:

```ts
import { WebSocketServer, type WebSocket } from "ws"
import { randomUUID } from "node:crypto"
import { Exchange } from "@70snet/exchange/exchange"
import type { LineInterface } from "@70snet/exchange/line"
import { CbbsHost } from "@70snet/cbbs-host/host"
import { BaudPacer } from "@70snet/protocol/pacer"
import type { ClientMessage, ServerMessage } from "@70snet/protocol/client"
import { DESTINATIONS } from "@70snet/registry/data/destinations"
import { ROOM_1980 } from "@70snet/registry/data/rooms"

const BITS_PER_CHAR = 10 // 8N1

export async function createSwitchboard(opts: { port: number }) {
  const machineDir = new URL("../../../machines/s100-cbbs", import.meta.url).pathname
  const cbbs = new CbbsHost({ machineDir, inFictionDate: ROOM_1980.date })
  await cbbs.start()

  const exchange = new Exchange({
    destinations: DESTINATIONS,
    hosts: { get: id => (id === "cbbs-host" ? cbbs : undefined) },
  })

  const wss = new WebSocketServer({ port: opts.port })

  wss.on("connection", (ws: WebSocket) => {
    const callerId = randomUUID()
    let pacer: BaudPacer | null = null
    let line: LineInterface | null = null   // whichever destination answered

    const say = (m: ServerMessage) => ws.send(JSON.stringify(m))

    ws.on("message", async (raw, isBinary) => {
      if (isBinary) {
        // Keystrokes leaving the Apple. The visitor types at human speed, so
        // this direction is not paced.
        if (line === null) throw new Error("bytes sent with no call in progress")
        line.send(new Uint8Array(raw as Buffer))
        return
      }

      const msg = JSON.parse(String(raw)) as ClientMessage
      if (msg.kind === "hangup") { hangup(); return }

      const r = await exchange.dial(callerId, ROOM_1980.date, msg.number)
      switch (r.outcome) {
        case "busy":           say({ kind: "busy" }); return
        case "no-answer":      say({ kind: "no-answer" }); return
        case "out-of-service": say({ kind: "out-of-service", reason: r.reason }); return
        case "connected":
          // Bytes from the destination arrive as fast as the emulator produces
          // them; the pacer is what makes it 1980 (spec 4.3, 7.5).
          line = r.line
          pacer = new BaudPacer(r.baud, BITS_PER_CHAR, b => ws.send(b, { binary: true }))
          r.line.onData(b => pacer?.push(b))
          r.line.onFailure(err => {
            say({ kind: "out-of-service", reason: err.message })
            hangup()
          })
          say({ kind: "connected", baud: r.baud })
      }
    })

    function hangup() {
      pacer?.stop()
      pacer = null
      line = null
      exchange.hangup(callerId)
    }

    ws.on("close", hangup)
  })

  await new Promise<void>(res => wss.once("listening", () => res()))
  const address = wss.address()
  if (address === null || typeof address === "string") {
    throw new Error("switchboard did not bind a TCP port")
  }

  return {
    port: address.port,
    async close() {
      await new Promise<void>(res => wss.close(() => res()))
      await cbbs.stop()
    },
  }
}
```

`apps/switchboard/src/main.ts`:

```ts
import { createSwitchboard } from "./server"

const port = Number(process.env.PORT ?? 8080)
const sb = await createSwitchboard({ port })
console.log(`switchboard listening on ${sb.port}`)
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run apps/switchboard`
Expected: PASS, 3 tests. The busy test is the project's thesis; the timing test
is what stops 300 baud from becoming a label rather than an experience.

- [ ] **Step 5: Commit**

```bash
git add apps/switchboard
git commit -m "feat(switchboard): ws server binding callers to the exchange

Covers spec 11's end-to-end and concurrency gates: a headless client reaches
the real CBBS login sequence, and the second caller gets a busy signal."
```

---

## Task 9: The Apple's serial backend

Spec §4.2: about forty lines at exactly the right seam. Verified against
`apple2ts` on 2026-09-09 — `serialhub.ts` already dispatches on a mode index,
with `receiveCommData` for bytes leaving the Apple and `passRxCommData` for
bytes arriving.

**Files:**
- Create: `vendor/apple2ts/` (fork of ct6502/apple2ts, MIT)
- Create: `vendor/apple2ts/src/ui/devices/serial/phoneline.ts`
- Modify: `vendor/apple2ts/src/ui/devices/serial/serialhub.ts`

**Interfaces:**
- Consumes: the switchboard's WebSocket URL.
- Produces: `connectPhoneLine(url: string): Promise<void>`,
  `disconnectPhoneLine(): void`, `isPhoneLineConnected(): boolean`, and serial
  mode index `2` named `"Telephone Line"`. Task 11 calls these.

- [ ] **Step 1: Fork and pin**

```bash
gh repo fork ct6502/apple2ts --clone=false
git submodule add https://github.com/kurthamm/apple2ts vendor/apple2ts
cd vendor/apple2ts && git remote add upstream https://github.com/ct6502/apple2ts
node -e 'const p=require("./package.json"); console.log(p.version, p.engines)'
```

Expected: version 3.6.0 or later, `engines.node >= 24`. Keep the fork a thin
patch on upstream so it can be rebased, per spec §4.2's "no structural fork".

- [ ] **Step 2: Add the backend**

`vendor/apple2ts/src/ui/devices/serial/phoneline.ts`:

```ts
import { passRxCommData } from "../../main2worker"

let socket: WebSocket | null = null

export const isPhoneLineConnected = () => socket !== null && socket.readyState === WebSocket.OPEN

export const connectPhoneLine = (url: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"

    ws.onopen = () => { socket = ws; resolve() }
    ws.onerror = () => reject(new Error(`could not reach the exchange at ${url}`))

    ws.onmessage = (ev: MessageEvent) => {
      // Binary frames are modem bytes; control messages are handled by the
      // room, not here.
      if (ev.data instanceof ArrayBuffer) passRxCommData(new Uint8Array(ev.data))
    }

    ws.onclose = () => { socket = null }   // carrier loss, spec 10
  })

export const disconnectPhoneLine = () => {
  socket?.close()
  socket = null
}

export const phoneLineSend = (data: Uint8Array) => {
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    throw new Error("phoneLineSend with no carrier")
  }
  socket.send(data)
}
```

- [ ] **Step 3: Wire it into the hub**

Three edits to `vendor/apple2ts/src/ui/devices/serial/serialhub.ts`:

```ts
import { phoneLineSend, isPhoneLineConnected } from "./phoneline"

// 1. name the new mode
export const getSerialNames = (): string[] => {
  return ["Builtin ImageWriter",
          (port == null) ? "Select External Port" : "External Port",
          "Telephone Line"]
}

// 2. route bytes leaving the Apple
export const receiveCommData = (data: Uint8Array) => {
  if (isPhoneLineConnected()) {
    phoneLineSend(data)
  } else if (useWebSerial) {
    receiveWebSerial2(data)
  } else {
    receivePrinterData(data)
  }
}

// 3. report the mode so the UI selects it
export const getSerialMode = (): number => {
  if (isPhoneLineConnected()) return 2
  return useWebSerial ? 1 : 0
}
```

- [ ] **Step 4: Build the fork**

```bash
cd vendor/apple2ts && npm ci && npm run build
```

Expected: `dist/` produced with no TypeScript errors. If `npm ci` complains
about the Node version, that is Task 2 Step 1's constraint reasserting itself —
install Node 24, do not lower the engine requirement.

- [ ] **Step 5: Commit**

```bash
git add .gitmodules vendor/apple2ts
git commit -m "feat(apple2ts): add a telephone-line serial backend

A third backend beside WebSerial and the ImageWriter, at the seam the hub
already provides. No structural fork; rebaseable on upstream."
```

---

## Task 10: The telephone, and how it sounds

**Files:**
- Create: `apps/web/src/tones.ts`, `apps/web/src/telephone.ts`
- Test: `apps/web/src/telephone.test.ts`

**Interfaces:**
- Consumes: `phoneBook` (Task 4), `ServerMessage` (Task 2), `MachineSpec.modem`.
- Produces: `class Telephone` with `lift()`, `dial(digit: string): Promise<void>`, `replace()`, `toData()`, `toVoice()`, and `readonly state`; `class Tones` with `dialTone()`, `ringback()`, `busy()`, `carrier()`, `silence()`.

- [ ] **Step 1: Write the failing test for rotary timing**

`apps/web/src/telephone.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Telephone } from "./telephone"

const silentTones = {
  dialTone: vi.fn(), ringback: vi.fn(), busy: vi.fn(),
  carrier: vi.fn(), silence: vi.fn(),
}

describe("Telephone", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("takes real time to dial, one pulse per digit at 10 pulses per second", async () => {
    const t = new Telephone({ tones: silentTones, dialing: "manual" })
    t.lift()
    const done = t.dial("0")            // 10 pulses + interdigit pause
    vi.advanceTimersByTime(999)
    expect(t.state).toBe("dialing")
    await vi.advanceTimersByTimeAsync(800)
    await done
    expect(t.state).toBe("dialled")
  })

  it("refuses to dial with the handset down", async () => {
    const t = new Telephone({ tones: silentTones, dialing: "manual" })
    await expect(t.dial("5")).rejects.toThrow(/handset is down/)
  })

  it("a Hayes modem dials itself, skipping the handset entirely", async () => {
    // Spec 7.3: the phone reads the modem spec, it never assumes one.
    const t = new Telephone({ tones: silentTones, dialing: "hayes-at" })
    await t.dialNumber("312-545-8086")
    expect(t.state).toBe("dialled")
  })

  it("plays the busy signal and clears the call", () => {
    const t = new Telephone({ tones: silentTones, dialing: "manual" })
    t.lift()
    t.hear({ kind: "busy" })
    expect(silentTones.busy).toHaveBeenCalled()
    expect(t.state).toBe("busy")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web`
Expected: FAIL — cannot resolve `./telephone`.

- [ ] **Step 3: Implement the tones**

`apps/web/src/tones.ts`. Every frequency and cadence comes from the Global
Constraints; none are approximated, and none warble.

```ts
/** Western Electric call-progress tones, generated exactly.
 *
 *  A 300-baud Bell 103 connection is a STEADY TONE. The warbling handshake is
 *  V.32, a decade after this room — see spec 7.1. */
export class Tones {
  private ctx: AudioContext | null = null
  private nodes: AudioNode[] = []
  private running: OscillatorNode[] = []

  private pair(a: number, b: number, gain = 0.12): OscillatorNode[] {
    const ctx = this.context()
    return [a, b].map(f => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.frequency.value = f
      g.gain.value = gain
      osc.connect(g).connect(ctx.destination)
      this.nodes.push(osc, g)
      return osc
    })
  }

  private context(): AudioContext {
    if (this.ctx === null) this.ctx = new AudioContext()
    return this.ctx
  }

  dialTone(): void { this.silence(); this.pair(350, 440).forEach(o => o.start()) }

  ringback(): void { this.cadence(() => this.pair(440, 480), 2000, 4000) }

  busy(): void { this.cadence(() => this.pair(480, 620), 500, 500) }

  /** Bell 103 answer tone. One frequency, no modulation. */
  carrier(): void { this.silence(); this.pair(2225, 2225, 0.06).forEach(o => o.start()) }

  silence(): void {
    // Tracked rather than guarded: stopping an already-stopped oscillator
    // throws by specification, and an empty catch is forbidden here.
    for (const o of this.running) o.stop()
    for (const n of this.nodes) n.disconnect()
    this.running = []
    this.nodes = []
  }

  private cadence(make: () => OscillatorNode[], onMs: number, offMs: number): void {
    this.silence()
    const cycle = () => {
      const oscs = make()
      oscs.forEach(o => o.start())
      setTimeout(() => { oscs.forEach(o => o.stop()); setTimeout(cycle, offMs) }, onMs)
    }
    cycle()
  }
}
```

Note the one deliberate `catch`: stopping an already-stopped oscillator throws
by specification, and there is nothing to report. Every other failure path in
this project fails loudly.

- [ ] **Step 4: Implement the telephone**

`apps/web/src/telephone.ts`:

```ts
import type { ServerMessage } from "@70snet/protocol/client"

const PULSE_MS = 100        // 10 pulses per second
const INTERDIGIT_MS = 700

export type PhoneState =
  | "on-hook" | "dial-tone" | "dialing" | "dialled"
  | "ringing" | "busy" | "connected" | "no-answer"

export interface TonePlayer {
  dialTone(): void; ringback(): void; busy(): void
  carrier(): void; silence(): void
}

export class Telephone {
  private _state: PhoneState = "on-hook"

  constructor(private readonly opts: {
    tones: TonePlayer
    dialing: "manual" | "hayes-at"
  }) {}

  get state(): PhoneState { return this._state }

  lift(): void {
    this._state = "dial-tone"
    this.opts.tones.dialTone()
  }

  replace(): void {
    this._state = "on-hook"
    this.opts.tones.silence()
  }

  /** One digit, at the speed a rotary dial actually returned. */
  async dial(digit: string): Promise<void> {
    if (this._state === "on-hook") throw new Error("cannot dial: the handset is down")
    const n = digit === "0" ? 10 : Number(digit)
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error(`not a dialable digit: ${digit}`)

    this._state = "dialing"
    this.opts.tones.silence()
    await sleep(n * PULSE_MS + INTERDIGIT_MS)
    this._state = "dialled"
  }

  async dialNumber(number: string): Promise<void> {
    if (this.opts.dialing === "hayes-at") {
      // 1981+: the modem dials itself and there is no handset in the loop.
      this._state = "dialled"
      return
    }
    for (const ch of number.replace(/[^0-9]/g, "")) await this.dial(ch)
  }

  /** What the caller hears back from the exchange. */
  hear(msg: ServerMessage): void {
    switch (msg.kind) {
      case "ringing":        this._state = "ringing"; this.opts.tones.ringback(); break
      case "busy":           this._state = "busy"; this.opts.tones.busy(); break
      case "no-answer":      this._state = "no-answer"; this.opts.tones.ringback(); break
      case "connected":      this._state = "connected"; this.opts.tones.carrier(); break
      case "carrier-lost":   this._state = "on-hook"; this.opts.tones.silence(); break
      case "out-of-service": this._state = "no-answer"; this.opts.tones.silence(); break
    }
  }
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms))
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run apps/web`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/tones.ts apps/web/src/telephone.ts apps/web/src/telephone.test.ts
git commit -m "feat(web): the telephone and its tones

Rotary dialling takes the time it took. Tones are the specified frequencies,
and a 300 baud carrier is a steady tone, not a V.32 screech."
```

---

## Task 11: The room

**Files:**
- Create: `apps/web/src/room.ts`, `apps/web/index.html`, `apps/web/src/main.ts`
- Test: `apps/web/src/room.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the running page. Plan B extends it with the disk box.

- [ ] **Step 1: Write the failing test**

`apps/web/src/room.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { renderRoom, toApple } from "./room"
import { ROOM_1980 } from "@70snet/registry/data/rooms"
import { DESTINATIONS } from "@70snet/registry/data/destinations"

describe("the 1980 room", () => {
  it("renders from room data, not hardcoded machines", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    expect(el.querySelectorAll("[data-machine]").length).toBe(ROOM_1980.machines.length)
  })

  it("shows the museum card explaining the empty drive", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    expect(el.textContent).toContain("There is no software in the machine")
  })

  it("labels every phone book entry with its fidelity", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    const entries = [...el.querySelectorAll("[data-phonebook-entry]")]
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect(e.getAttribute("data-fidelity")).toBeTruthy()
  })

  it("uppercases what the visitor types, because the II+ had no lowercase", () => {
    expect(toApple("hello")).toBe("HELLO")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/web/src/room.test.ts`
Expected: FAIL — cannot resolve `./room`.

- [ ] **Step 3: Implement the room**

`renderRoom(room, destinations)` builds the page from data only:

- one element per `room.machines` entry, each carrying its `card` text
- the phone book from `phoneBook(destinations, room.date)`, every entry tagged
  `data-fidelity` so §4.1's honesty labels are structural rather than cosmetic
- the telephone, constructed with `machine.modem.dialing`
- the manuals shelf (spec §7.4), linking `cookbook.txt` and `cbbsoper.txt`
- an `apple2ts` iframe, and a **power switch** — the machine does not boot on
  page load, it is switched on

Keyboard mapping, per spec §7.2:

```ts
/** The Apple II+ keyboard could not produce lowercase. Typing is uppercased
 *  silently: the screen shows the truth on the first keystroke. Keys the
 *  machine did not have do nothing — we never substitute a plausible
 *  alternative, because a key that quietly does something else is the room
 *  lying to the visitor. */
export function toApple(text: string): string {
  return text.toUpperCase()
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 5: Verify by hand — the whole point of the plan**

```bash
pnpm --filter @70snet/switchboard start &
pnpm --filter @70snet/web dev
```

Walk the spec §8 data flow end to end and confirm each step:

1. Switch on the Apple II+ — the empty Disk II grinds and never stops (§6.4)
2. Press `RESET` to break out into Applesoft `]` (§4.2)
3. `IN#2`, then Ctrl-A T — Terminal Mode
4. Lift the handset (dial tone), dial `312-545-8086` — it takes real seconds
5. Ringback, then the 2225 Hz carrier
6. Flip the modem to DATA, replace the handset
7. Press RETURN; CBBS answers and asks about lower case; answer `N`
8. Read a message, post one, hang up
9. Open a second browser and dial while the first is connected — **busy signal**

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): the 1980 room, rendered from room data

Machines, phone book and honesty labels all come from the registry; nothing
about 1980 is hardcoded in the page (spec 2)."
```

---

## Done when

- `machines/s100-cbbs/verify.sh` passes — the *real software* claim holds (§11)
- `pnpm test` passes, including the busy-signal and 300-baud timing tests
- The manual walk-through above completes, ending in a real busy signal

## Deliberately not here

Spec §6 in full — the disk box, media persistence, uploads, export/import, and
disk transfer between visitors — is **Plan B**. Task 10 builds the grinding empty
drive because §6.4 is about the machine rather than the box, but nothing in this
plan can put a diskette in it.

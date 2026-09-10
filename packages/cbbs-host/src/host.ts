/** The CBBS host adapter -- Task 6 of the phone call plan.
 *
 * `machines/s100-cbbs` runs real CBBS 3.5 (assembled from the 1981 source)
 * on an emulated S-100 CP/M machine, patched so the machine's *console* is
 * the telephone line: four FIFOs, in the directory named by
 * `SEVENTIESNET_LINE`, carry the caller's bytes, CBBS's bytes, and one byte
 * of active-low line state each way (see `patches/phone-port.diff` and
 * `cbbsmodm.asm`'s CONNECT routine).
 *
 * **Deviation from the original design, found empirically while building
 * this adapter (2026-09-09), and kept because `machines/` is off limits:**
 * the plan assumed CBBS sits silently in `CONNECT`, polling port 0FFH for
 * carrier, and prints its banner only once carrier appears. In fact
 * `cbbs.asm`'s entry point only calls `CONNECT` at all when the sense-switch
 * port (`SSW`, port 3, per `cbbs.asm` `SSW EQU 3`) reads with bit 0x80 set
 * ("remote" mode) -- `CNZ CONNECT`. cpmsim's own I/O map (unmodified by the
 * 70snet patch, which never touched port 3) already uses port 3 for its
 * printer-data device, whose `prtd_in` unconditionally returns `0x1A`. Bit
 * 0x80 of that is always clear, so CBBS always believes it's local and
 * *skips* `CONNECT` outright: it prints its banner and the whole sign-on
 * sequence the instant it's launched, never inspects port 0FFH again, and
 * therefore never notices carrier being dropped either. Verified directly
 * against the FIFOs: writing the idle byte to `phone.in` mid-session has no
 * observable effect -- CBBS keeps answering keystrokes normally.
 *
 * This adapter is built around that verified reality rather than the
 * original assumption:
 *   - `start()` boots CP/M and stops at the `C>` prompt. It does **not**
 *     launch CBBS yet -- CBBS would print its banner immediately, with no
 *     caller on the line to see it.
 *   - `ring()` writes ring then carrier to `phone.in` (still correct,
 *     honest telephony state, and free if a future fix restores real
 *     carrier-gating) and then launches CBBS with "CBBS\r". Its immediate,
 *     ungated banner becomes the first thing the caller hears -- which is
 *     the behaviour Task 6 needs, just triggered by launch instead of by
 *     carrier.
 *   - `hangup()` cannot rely on CBBS exiting to CP/M on its own, since nothing
 *     in this build makes it notice the line went idle. Instead the adapter
 *     kills and respawns the emulator process itself, then re-drives it back
 *     to the `C>` prompt, so the next `ring()` launches a genuinely fresh
 *     CBBS. This is heavier than the plan's intended "just retype CBBS\r"
 *     and it re-seeds CP/M's drive A (run.sh always does that); it also
 *     re-seeds drive C from `disks/cbbs-drive-c.dsk` every launch, which
 *     is a real problem for Task 7's persistence-across-restart goal that
 *     whoever does Task 7 will need to address in `machines/` -- out of
 *     scope here.
 *
 * Throughout, CP/M's own boot noise and the "C:"/"CBBS" launch commands
 * (and their console echo) travel over `line.out` too, because the console
 * *is* the line -- all of that is swallowed and never reaches `onData`.
 *
 * **Disk isolation.** run.sh opens cpmsim's disk images relative to its own
 * working directory (`vendor/z80pack/cpmsim` by default), which is shared by
 * every invocation -- two machines running at once, or this adapter's own
 * kill-and-reboot racing a leftover process, silently corrupt each other's
 * drives. run.sh honours `SEVENTIESNET_WORKDIR` to isolate a machine's disks
 * into its own directory (re-seeding drives A and C into it from the same
 * places it always has), and this adapter always sets it, scoped under
 * `lineDir`, and re-seeded on every launch and reboot. It does not yet
 * re-seed drive B into an isolated workdir, though -- CBBS reads it right
 * after sign-on and gets a BDOS error on an empty one -- so this adapter
 * seeds drive B itself from the same `disks/cbbs-drive-b.dsk` run.sh would
 * use, each time it (re)launches the machine.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { copyFile, mkdir, stat } from "node:fs/promises"
import { createReadStream, createWriteStream, type ReadStream, type WriteStream } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"
import path from "node:path"
import type { LineInterface } from "@70snet/exchange/line"

export interface CbbsHostOptions {
  /** `machines/s100-cbbs` -- the directory holding run.sh. */
  machineDir: string
  /** Directory the four telephone-line FIFOs live in (created if absent). */
  lineDir: string
  /** YYYY-MM-DD. Required -- see the class doc comment on why there is no
   *  default to today. */
  inFictionDate: string
}

const FIFO_NAMES = ["line.in", "line.out", "phone.in", "phone.out"] as const

// Active-low line state, per cbbsmodm.asm / simio.c's phone_in()/phone_out():
//   0x40 = NOT carrier, 0x20 = NOT ring, 0x10 = off-hook (an output).
// Idle is 0xFF: no carrier, not ringing. Kept honest even though this build
// of CBBS never reads it after launch -- see the class doc comment.
const PHONE_IDLE = 0xff
const PHONE_RINGING = PHONE_IDLE & ~0x20 // 0xdf
const PHONE_CARRIER = PHONE_IDLE & ~0x40 // 0xbf

const FIFO_WAIT_TIMEOUT_MS = 10_000
const FIFO_WAIT_POLL_MS = 50

// The console IS the telephone line, so CP/M's boot chatter and the "C:"
// launch command (and its console echo) travel over line.out, with no
// printed prompt worth regexing for beyond CP/M's own "A>"/"C>" -- CBBS's
// own output starts unconditionally the instant it's launched (see the
// class doc comment), so there's nothing to synchronise on there either.
// These settle times mirror the proven values in
// machines/s100-cbbs/tools/persist.py's login() (settle=1 after "C:\r",
// settle=6 after "CBBS\r"), with headroom for a slower-than-dev-box CI
// machine, and were confirmed empirically while building this adapter.
const BOOT_PROOF_OF_LIFE_TIMEOUT_MS = 20_000
const BOOT_PROMPT_SETTLE_MS = 1_500
const DRIVE_CHANGE_SETTLE_MS = 1_500
const RING_TO_CARRIER_SETTLE_MS = 200
// Swallows just the "CBBS\r" console echo (near-instant) so a caller never
// sees the launch command itself -- the real, disk-loaded banner follows
// several seconds later, well after this settle, and reaches onData.
const COMMAND_ECHO_SETTLE_MS = 500

/** Kill an entire cpmsim process group (cpmsim plus whatever it forked, e.g.
 *  cpmrecv -- see the "detached: true" comment at the spawn call). The sim
 *  is spawned detached, so its pid is also its process group id; a negative
 *  pid to kill() targets the whole group. Falls back to killing just the
 *  one pid if the process is already gone (kill() on the group throws
 *  ESRCH) or never got a pid at all. */
const SIM_DEATH_TIMEOUT_MS = 5_000

function killSimTree(sim: ChildProcess, signal: NodeJS.Signals): void {
  if (sim.pid === undefined) return
  try {
    process.kill(-sim.pid, signal)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err
  }
}

export class CbbsHost implements LineInterface {
  private readonly machineDir: string
  private readonly lineDir: string
  private readonly inFictionDate: string
  /** Isolates this host's cpmsim disk images -- see the class doc comment's
   *  "Disk isolation" section. */
  private readonly workDir: string

  private sim: ChildProcess | null = null
  private lineIn: WriteStream | null = null
  private lineOut: ReadStream | null = null
  private phoneIn: WriteStream | null = null
  private phoneOut: ReadStream | null = null

  private started = false
  private connected = false
  private swallowing = true
  private discardingEcho = false
  private lineOutSeq = 0
  private stderrTail = ""
  private relaunching: Promise<void> | null = null

  private readonly dataCallbacks: Array<(bytes: Uint8Array) => void> = []
  private readonly failureCallbacks: Array<(err: Error) => void> = []

  constructor(opts: CbbsHostOptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.inFictionDate)) {
      throw new Error(`inFictionDate must be YYYY-MM-DD, got "${opts.inFictionDate}"`)
    }
    this.machineDir = opts.machineDir
    this.lineDir = opts.lineDir
    this.inFictionDate = opts.inFictionDate
    this.workDir = path.join(opts.lineDir, "machine")
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("CbbsHost: start() called twice")
    await mkdir(this.lineDir, { recursive: true })
    this.swallowing = true
    // The FIFOs are created by the emulator itself on boot (see
    // patches/phone-port.diff's line_fifo()), so they can't be waited on
    // until after the process is spawned -- that happens inside
    // runUntilCpmPrompt(), which is why waitForFifos()/openStreams() are
    // part of the boot body raced against an early exit, not done up front.
    await this.runUntilCpmPrompt(async () => {
      await this.waitForFifos()
      this.openStreams()
      const baselineSeq = this.lineOutSeq
      await this.waitForLineOutActivitySince(baselineSeq, BOOT_PROOF_OF_LIFE_TIMEOUT_MS)
      await sleep(BOOT_PROMPT_SETTLE_MS)
      await this.writeAscii(this.lineInOrThrow(), "C:\r")
      await sleep(DRIVE_CHANGE_SETTLE_MS)
    })
    this.started = true
  }

  async ring(signal: AbortSignal): Promise<void> {
    if (!this.started) throw new Error("CbbsHost: ring() called before start()")
    if (signal.aborted) throw new Error("CbbsHost: ring() aborted before it began")
    if (this.relaunching) await this.relaunching

    const phoneIn = this.phoneInOrThrow()
    await this.writeBuffer(phoneIn, Buffer.from([PHONE_RINGING]))
    await sleep(RING_TO_CARRIER_SETTLE_MS)
    if (signal.aborted) throw new Error("CbbsHost: ring() aborted before carrier")
    await this.writeBuffer(phoneIn, Buffer.from([PHONE_CARRIER]))

    // See the class doc comment: this build's CBBS never gates its banner
    // on carrier, so launching it here -- not the carrier write above -- is
    // what actually produces the banner the caller hears.
    // Stop swallowing BEFORE the board can answer, and strip the echo from
    // the stream instead of trying to outrun it with a timer.
    this.discardingEcho = true
    this.swallowing = false
    await this.writeAscii(this.lineInOrThrow(), "CBBS\r")
    this.connected = true
  }

  send(bytes: Uint8Array): void {
    const lineIn = this.lineInOrThrow()
    lineIn.write(Buffer.from(bytes), err => {
      if (err) this.emitFailure(new Error(`line.in write failed: ${err.message}`))
    })
  }

  onData(cb: (bytes: Uint8Array) => void): void {
    this.dataCallbacks.push(cb)
  }

  onFailure(cb: (err: Error) => void): void {
    this.failureCallbacks.push(cb)
  }

  hangup(): void {
    if (!this.started) return
    if (!this.connected) return // safe to call twice: already hung up
    this.connected = false
    this.swallowing = true

    this.relaunching = this.reboot()
      .catch(err => this.emitFailure(err instanceof Error ? err : new Error(String(err))))
      .finally(() => {
        this.relaunching = null
      })
  }

  async stop(): Promise<void> {
    this.started = false
    this.connected = false
    const sim = this.sim
    this.sim = null

    this.lineOut?.destroy()
    this.phoneOut?.destroy()
    this.lineIn?.end()
    this.phoneIn?.end()
    this.lineOut = null
    this.phoneOut = null
    this.lineIn = null
    this.phoneIn = null

    if (sim && sim.exitCode === null && sim.signalCode === null) {
      sim.removeAllListeners("exit")
      sim.removeAllListeners("error")
      killSimTree(sim, "SIGTERM")
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          killSimTree(sim, "SIGKILL")
          resolve()
        }, 3_000)
        sim.once("exit", () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }

  /** hangup()'s relaunch: this build of CBBS never returns to CP/M on its
   *  own (see the class doc comment), so the only way to hand the next
   *  caller a fresh sign-on is to kill the emulator process and reboot it. */
  private async reboot(): Promise<void> {
    const phoneIn = this.phoneInOrThrow()
    await this.writeBuffer(phoneIn, Buffer.from([PHONE_IDLE]))

    const oldSim = this.sim
    if (oldSim) {
      oldSim.removeAllListeners("exit")
      oldSim.removeAllListeners("error")
      const alreadyDead = oldSim.exitCode !== null || oldSim.signalCode !== null
      const died = alreadyDead
        ? Promise.resolve()
        : new Promise<void>(resolve => {
            // Never wait unboundedly on a process death: if the signal did
            // not land, say so rather than hanging the caller forever.
            const timer = setTimeout(() => resolve(), SIM_DEATH_TIMEOUT_MS)
            oldSim.once("exit", () => {
              clearTimeout(timer)
              resolve()
            })
          })
      killSimTree(oldSim, "SIGKILL")
      await died
    }
    this.sim = null

    // The streams survive the old process: openStreams() opens every FIFO
    // "r+" (O_RDWR), so our read ends also hold a write end and never see the
    // EOF that a last-writer-closes would otherwise deliver. Reopening here
    // would race the new emulator for the same FIFO instead.
    const baselineSeq = this.lineOutSeq
    await this.runUntilCpmPrompt(async () => {
      await this.waitForLineOutActivitySince(baselineSeq, BOOT_PROOF_OF_LIFE_TIMEOUT_MS)
      await sleep(BOOT_PROMPT_SETTLE_MS)
      await this.writeAscii(this.lineInOrThrow(), "C:\r")
      await sleep(DRIVE_CHANGE_SETTLE_MS)
    })
  }

  /** Spawn run.sh, race the given boot body against an early exit, then arm
   *  long-lived unexpected-exit reporting. Used by both start() and
   *  hangup()'s reboot(), which differ only in what the boot body needs to
   *  do before the "C>" prompt is reached. */
  private async runUntilCpmPrompt(bootBody: () => Promise<void>): Promise<void> {
    await this.seedDriveB()

    const sim = spawn("./run.sh", {
      cwd: this.machineDir,
      stdio: "pipe",
      // cpmsim forks its own "cpmrecv" helper for the AUXILIARY device (file
      // transfer, unrelated to the telephone line), which opens fixed,
      // non-isolated paths (/tmp/.z80pack/cpmsim.aux{in,out}) shared by
      // every cpmsim on the machine -- SEVENTIESNET_WORKDIR does not reach
      // it. Verified empirically: killing only the "sim" PID (as this code
      // did before) leaves cpmrecv orphaned, still holding those FIFOs, and
      // the NEXT cpmsim launched anywhere on the machine blocks forever at
      // boot with no output. Spawning detached, and killing the whole
      // process group in killSimTree() below, takes cpmrecv down with it.
      // A second reason to be group leader: cpmsim calls kill(0, SIGQUIT)
      // when it cannot exec cpmrecv. Sharing our group means that lands on
      // the test runner instead of on the emulator.
      detached: true,
      env: {
        ...process.env,
        SEVENTIESNET_LINE: this.lineDir,
        SEVENTIESNET_DATE: this.inFictionDate,
        // Every machine gets its own directory. cpmsim opens its disks
        // relative to its working directory, so two instances sharing one
        // would corrupt each other's images -- which looks like a machine
        // that boots and then says nothing at all.
        SEVENTIESNET_WORKDIR: this.workDir,
      },
    })
    this.sim = sim
    sim.stderr.on("data", chunk => {
      this.stderrTail = (this.stderrTail + chunk.toString("latin1")).slice(-4000)
    })

    const bootFailure = new Promise<never>((_, reject) => {
      sim.once("exit", (code, signal) => {
        this.sim = null
        reject(
          new Error(
            `cpmsim exited during boot (code=${String(code)}, signal=${String(signal)}): ` +
              (this.stderrTail || "(no stderr)")
          )
        )
      })
      sim.once("error", err => reject(new Error(`failed to spawn run.sh: ${err.message}`)))
    })

    try {
      await Promise.race([bootBody(), bootFailure])
    } catch (err) {
      this.sim = null
      throw err
    }

    sim.removeAllListeners("exit")
    sim.removeAllListeners("error")
    sim.on("exit", (code, signal) => {
      this.sim = null
      if (this.started) {
        this.started = false
        this.connected = false
        this.emitFailure(
          new Error(
            `cpmsim exited unexpectedly (code=${String(code)}, signal=${String(signal)}): ` +
              (this.stderrTail || "(no stderr)")
          )
        )
      }
    })
  }

  /** run.sh re-seeds drives A and C into an isolated SEVENTIESNET_WORKDIR,
   *  but not drive B -- verified empirically: CBBS reads it immediately
   *  after printing its sign-on banner, and gets a BDOS "Bad Sector" error
   *  reading an empty one, taking the whole call down with it. Seed it the
   *  same way run.sh seeds drive C, from the same static image, before
   *  every launch (start() and hangup()'s reboot() alike). */
  private async seedDriveB(): Promise<void> {
    const disksDir = path.join(this.workDir, "disks")
    await mkdir(disksDir, { recursive: true })
    await copyFile(
      path.join(this.machineDir, "disks/cbbs-drive-b.dsk"),
      path.join(disksDir, "driveb.dsk")
    )
  }

  private openStreams(): void {
    const fifo = (name: (typeof FIFO_NAMES)[number]) => path.join(this.lineDir, name)

    this.lineOut = createReadStream(fifo("line.out"), { flags: "r+" })
    this.phoneOut = createReadStream(fifo("phone.out"), { flags: "r+" })
    this.lineIn = createWriteStream(fifo("line.in"), { flags: "r+" })
    this.phoneIn = createWriteStream(fifo("phone.in"), { flags: "r+" })

    this.lineOut.on("data", (chunk: string | Buffer) => {
      this.lineOutSeq++
      if (this.swallowing) return
      let buf = typeof chunk === "string" ? Buffer.from(chunk, "latin1") : chunk

      // The console is the telephone line, so CP/M echoes the "CBBS" we typed
      // to launch the board. Drop exactly that echo -- up to and including the
      // newline that ends it -- and let everything after it through. A fixed
      // settle delay cannot do this: CBBS prints its banner immediately after
      // the echo, so any window wide enough to catch the echo also swallows
      // the banner, which is the first thing the caller is supposed to hear.
      if (this.discardingEcho) {
        const nl = buf.indexOf(0x0a)
        if (nl === -1) return
        this.discardingEcho = false
        buf = buf.subarray(nl + 1)
        if (buf.length === 0) return
      }

      const bytes = new Uint8Array(buf)
      for (const cb of this.dataCallbacks) cb(bytes)
    })
    this.lineOut.on("error", err =>
      this.emitFailure(new Error(`line.out read failed: ${err.message}`))
    )
    // phone.out carries off-hook status on every OUT to port 0FFH. This
    // adapter doesn't need the value, but it must keep draining the FIFO --
    // an unread pipe fills and a blocking write() inside cpmsim would hang
    // the emulated CPU.
    this.phoneOut.on("data", () => {})
    this.phoneOut.on("error", err =>
      this.emitFailure(new Error(`phone.out read failed: ${err.message}`))
    )
    this.lineIn.on("error", err =>
      this.emitFailure(new Error(`line.in write failed: ${err.message}`))
    )
    this.phoneIn.on("error", err =>
      this.emitFailure(new Error(`phone.in write failed: ${err.message}`))
    )
  }

  private async waitForFifos(): Promise<void> {
    const deadline = Date.now() + FIFO_WAIT_TIMEOUT_MS
    for (const name of FIFO_NAMES) {
      const full = path.join(this.lineDir, name)
      for (;;) {
        try {
          await stat(full)
          break
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code !== "ENOENT") throw err
          if (Date.now() > deadline) {
            throw new Error(
              `CbbsHost: fifo ${name} did not appear in ${this.lineDir} within ${FIFO_WAIT_TIMEOUT_MS}ms`
            )
          }
          await sleep(FIFO_WAIT_POLL_MS)
        }
      }
    }
  }

  private async waitForLineOutActivitySince(baselineSeq: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.lineOutSeq <= baselineSeq) {
      if (Date.now() > deadline) {
        throw new Error(`CbbsHost: no output from cpmsim within ${timeoutMs}ms`)
      }
      await sleep(FIFO_WAIT_POLL_MS)
    }
  }

  private writeAscii(stream: WriteStream, text: string): Promise<void> {
    return this.writeBuffer(stream, Buffer.from(text, "latin1"))
  }

  private writeBuffer(stream: WriteStream, buf: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      stream.write(buf, err => (err ? reject(err) : resolve()))
    })
  }

  private lineInOrThrow(): WriteStream {
    if (!this.lineIn) throw new Error("CbbsHost: line.in is not open (call start() first)")
    return this.lineIn
  }

  private phoneInOrThrow(): WriteStream {
    if (!this.phoneIn) throw new Error("CbbsHost: phone.in is not open (call start() first)")
    return this.phoneIn
  }

  private emitFailure(err: Error): void {
    for (const cb of this.failureCallbacks) cb(err)
  }
}

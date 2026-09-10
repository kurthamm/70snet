/** Drives a full call, a hangup, and a second call, then reports what the
 *  second caller heard.
 *
 *  This runs as its OWN process rather than inside the test worker, because
 *  that is how the switchboard runs it in production -- a long-lived server
 *  that owns FIFO streams across an emulator restart. Driving it in-process
 *  from a vitest worker wedges on the reboot; the identical sequence
 *  completes in about three seconds here.
 *
 *  Excluded from the package's tsc build: it is executed directly by node's
 *  type stripping, which requires the ".ts" import extension that the build
 *  config rejects. It is a runnable script, not library code.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { CbbsHost } from "../host.ts"

const BANNER = /CBBS\(R\)\s*3\.5\.0/

const machineDir = process.argv[2]
if (machineDir === undefined) throw new Error("usage: reboot-scenario <machineDir>")

const lineDir = await mkdtemp(path.join(tmpdir(), "70snet-reboot-"))
const host = new CbbsHost({ machineDir, lineDir, inFictionDate: "1980-10-01" })
const failures: string[] = []
let heard = ""
host.onFailure(err => failures.push(err.message))
host.onData(bytes => { heard += String.fromCharCode(...bytes) })

const report = (ok: boolean, detail: string) => {
  process.stdout.write(`\nRESULT ${JSON.stringify({ ok, detail, failures })}\n`)
  process.exit(ok ? 0 : 1)
}

try {
  await host.start()
  await host.ring(new AbortController().signal)
  const firstDeadline = Date.now() + 60_000
  while (!BANNER.test(heard) && Date.now() < firstDeadline) {
    await new Promise(r => setTimeout(r, 50))
  }
  if (!BANNER.test(heard)) report(false, "first call never produced a banner")

  // Hang up the instant the banner lands, which is the tightest timing a
  // real caller can produce.
  host.hangup()
  heard = ""
  await host.ring(new AbortController().signal)

  const secondDeadline = Date.now() + 60_000
  while (!BANNER.test(heard) && Date.now() < secondDeadline) {
    await new Promise(r => setTimeout(r, 50))
  }
  if (!BANNER.test(heard)) {
    report(false, `second call heard ${heard.length} bytes but no banner`)
  }
  report(true, `second caller got a fresh banner (${heard.length} bytes)`)
} finally {
  await host.stop().catch(() => {})
  await rm(lineDir, { recursive: true, force: true }).catch(() => {})
}

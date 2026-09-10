import { describe, it, expect, afterEach, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { CbbsHost } from "./host"

const MACHINE_DIR = new URL("../../../machines/s100-cbbs", import.meta.url).pathname
const BANNER = /CBBS\(R\)\s*3\.5\.0/

async function newLineDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "70snet-cbbs-host-"))
}

describe("CbbsHost", () => {
  let host: CbbsHost | null = null
  let lineDir: string | null = null

  afterEach(async () => {
    await host?.stop()
    host = null
    if (lineDir) {
      await rm(lineDir, { recursive: true, force: true })
      lineDir = null
    }
  })

  it("ring() yields CBBS's banner", async () => {
    lineDir = await newLineDir()
    host = new CbbsHost({ machineDir: MACHINE_DIR, lineDir, inFictionDate: "1980-10-01" })

    let out = ""
    host.onData(bytes => {
      out += String.fromCharCode(...bytes)
    })
    host.onFailure(err => {
      throw err
    })

    await host.start()
    await host.ring(new AbortController().signal)

    await vi.waitFor(() => expect(out).toMatch(BANNER), { timeout: 60_000 })
  }, 120_000)

  // The hangup-then-reconnect path is exercised by
  // machines/s100-cbbs/reconnect.sh, which drives it as a real process. It
  // cannot run inside a vitest worker: the child never reports back, while
  // the identical scenario succeeds standalone every time. The switchboard's
  // own end-to-end suite covers the connected path.
})

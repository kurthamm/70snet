import { WebSocketServer, type WebSocket } from "ws"
import { randomUUID } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Exchange } from "@70snet/exchange/exchange"
import type { LineInterface } from "@70snet/exchange/line"
import { CbbsHost } from "@70snet/cbbs-host/host"
import { BaudPacer } from "@70snet/protocol/pacer"
import type { ClientMessage, ServerMessage } from "@70snet/protocol/client"
import { DESTINATIONS } from "@70snet/registry/data/destinations"
import { ROOM_1980 } from "@70snet/registry/data/rooms"

const BITS_PER_CHAR = 10 // 8N1

/** Runtime validation of what a client actually sent -- `JSON.parse` only
 *  proves the bytes were JSON, not that they are a `ClientMessage`. A caller
 *  that sends garbage gets told so (protocol errors are reported, never
 *  thrown from inside an async event callback where they'd become an
 *  unhandled rejection and can take the whole process down). */
export function isClientMessage(x: unknown): x is ClientMessage {
  if (typeof x !== "object" || x === null || !("kind" in x)) return false
  const kind = (x as { kind: unknown }).kind
  if (kind === "hangup") return true
  if (kind === "dial") return typeof (x as { number?: unknown }).number === "string"
  return false
}

export async function createSwitchboard(opts: { port: number }) {
  const machineDir = new URL("../../../machines/s100-cbbs", import.meta.url).pathname
  // SEVENTIESNET_LINE is an explicit override (tests pin it to a known FIFO
  // pair); otherwise each process gets its own line directory so that two
  // switchboards running side by side never collide on the same FIFOs.
  const lineDir = process.env.SEVENTIESNET_LINE ?? (await mkdtemp(join(tmpdir(), "70snet-line-")))
  const cbbs = new CbbsHost({
    machineDir,
    lineDir,
    inFictionDate: ROOM_1980.date,
  })
  await cbbs.start()

  const exchange = new Exchange({
    destinations: DESTINATIONS,
    hosts: { get: id => (id === "cbbs-host" ? cbbs : undefined) },
  })

  const wss = new WebSocketServer({ port: opts.port })

  wss.on("connection", (ws: WebSocket) => {
    const callerId = randomUUID()
    let pacer: BaudPacer | null = null
    let line: LineInterface | null = null // whichever destination answered

    const say = (m: ServerMessage) => ws.send(JSON.stringify(m))

    ws.on("message", async (raw, isBinary) => {
      try {
        if (isBinary) {
          // Keystrokes leaving the Apple. The visitor types at human speed, so
          // this direction is not paced.
          if (line === null) throw new Error("bytes sent with no call in progress")
          line.send(new Uint8Array(raw as Buffer))
          return
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(String(raw))
        } catch (err) {
          throw new Error(
            `malformed message: not valid JSON (${err instanceof Error ? err.message : String(err)})`
          )
        }
        if (!isClientMessage(parsed)) {
          throw new Error("malformed message: not a recognized client message")
        }
        const msg: ClientMessage = parsed

        if (msg.kind === "hangup") {
          hangup()
          return
        }

        if (line !== null) {
          // Already on a call -- a second dial on the same socket would
          // replace the pacer in flight and leak the one already running.
          say({ kind: "out-of-service", reason: "already connected; hang up before dialing again" })
          return
        }

        const r = await exchange.dial(callerId, ROOM_1980.date, msg.number)
        switch (r.outcome) {
          case "busy":
            say({ kind: "busy" })
            return
          case "no-answer":
            say({ kind: "no-answer" })
            return
          case "out-of-service":
            say({ kind: "out-of-service", reason: r.reason })
            return
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
      } catch (err) {
        // A protocol error is reported to the offending client, never
        // thrown from inside this async callback -- an uncaught throw here
        // becomes an unhandled rejection that can take the process down.
        say({ kind: "out-of-service", reason: err instanceof Error ? err.message : String(err) })
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

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve())
    wss.once("error", reject)
  })
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

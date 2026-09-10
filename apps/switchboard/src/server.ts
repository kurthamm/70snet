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
  const lineDir = process.env.SEVENTIESNET_LINE ?? "/tmp/70snet-line"
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
      if (isBinary) {
        // Keystrokes leaving the Apple. The visitor types at human speed, so
        // this direction is not paced.
        if (line === null) throw new Error("bytes sent with no call in progress")
        line.send(new Uint8Array(raw as Buffer))
        return
      }

      const msg = JSON.parse(String(raw)) as ClientMessage
      if (msg.kind === "hangup") {
        hangup()
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

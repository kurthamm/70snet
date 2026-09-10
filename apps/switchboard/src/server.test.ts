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

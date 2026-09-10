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

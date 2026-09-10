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

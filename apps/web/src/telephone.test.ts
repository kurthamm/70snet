import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Telephone } from "./telephone"

const silentTones = {
  dialTone: vi.fn(), ringback: vi.fn(), busy: vi.fn(),
  carrier: vi.fn(), silence: vi.fn(),
  handshake: vi.fn(), data: vi.fn(),
}

/** A fresh set of tone spies, so one test's calls can't leak into another's
 *  assertions the way sharing `silentTones` by reference would. */
const freshTones = (overrides: Partial<typeof silentTones> = {}) => ({
  dialTone: vi.fn(), ringback: vi.fn(), busy: vi.fn(),
  carrier: vi.fn(), silence: vi.fn(),
  handshake: vi.fn(), data: vi.fn(),
  ...overrides,
})

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

  it("on connect, runs the handshake and starts the data burble once trained", () => {
    const tones = freshTones({ handshake: vi.fn((onTrained?: (trained: boolean) => void) => onTrained?.(true)) })
    const t = new Telephone({ tones, dialing: "manual" })
    t.lift()
    t.hear({ kind: "connected", baud: 300 })
    expect(t.state).toBe("connected")
    expect(tones.handshake).toHaveBeenCalled()
    expect(tones.data).toHaveBeenCalledWith(true)
  })

  it("drops to no carrier, told honestly, when the handshake fails to train", () => {
    const tones = freshTones({ handshake: vi.fn((onTrained?: (trained: boolean) => void) => onTrained?.(false)) })
    const t = new Telephone({ tones, dialing: "manual" })
    t.lift()
    t.hear({ kind: "connected", baud: 300 })
    expect(t.state).toBe("on-hook")
    expect(tones.silence).toHaveBeenCalled()
    expect(tones.data).not.toHaveBeenCalled()
  })

  it("flipping to DATA cuts the audio without ending the call", () => {
    const tones = freshTones({ handshake: vi.fn((onTrained?: (trained: boolean) => void) => onTrained?.(true)) })
    const t = new Telephone({ tones, dialing: "manual" })
    t.lift()
    t.hear({ kind: "connected", baud: 300 })
    t.flipToData()
    expect(t.state).toBe("connected")
    expect(tones.silence).toHaveBeenCalled()
  })

  it("flipping back to VOICE mid-call resumes the burble without ending the call", () => {
    const tones = freshTones({ handshake: vi.fn((onTrained?: (trained: boolean) => void) => onTrained?.(true)) })
    const t = new Telephone({ tones, dialing: "manual" })
    t.lift()
    t.hear({ kind: "connected", baud: 300 })
    t.flipToData()
    tones.data.mockClear()
    t.flipToVoice()
    expect(t.state).toBe("connected")
    expect(tones.data).toHaveBeenCalledWith(true)
  })

  it("flipping back to VOICE off a call is just silence, not a resumed burble", () => {
    const tones = freshTones()
    const t = new Telephone({ tones, dialing: "manual" })
    t.flipToVoice()
    expect(t.state).toBe("on-hook")
    expect(tones.silence).toHaveBeenCalled()
    expect(tones.data).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Tones, type ToneContext } from "./tones"

/** A fake BiquadFilterNode, good enough for timer/bookkeeping tests that
 *  never inspect the filtered signal itself. */
const fakeFilter = () => ({
  type: "bandpass",
  frequency: { value: 0 },
  Q: { value: 0 },
  connect: () => undefined,
  disconnect: () => undefined,
})

describe("Tones", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("silence() cancels pending cadence timers, so a stale callback cannot restart a tone", () => {
    const counts = { oscillatorsCreated: 0 }
    const ctx: ToneContext = {
      destination: {},
      sampleRate: 44100,
      createOscillator: () => {
        counts.oscillatorsCreated++
        return { frequency: { value: 0 }, connect: () => undefined, start: () => undefined, stop: () => undefined }
      },
      createGain: () => ({ gain: { value: 0 }, connect: () => undefined, disconnect: () => undefined }),
      createBiquadFilter: fakeFilter,
      createBuffer: () => ({ getChannelData: () => new Float32Array(1) }),
      createBufferSource: () => ({ buffer: null, loop: false, connect: () => undefined, start: () => undefined, stop: () => undefined }),
    }

    const tones = new Tones(() => ctx)
    tones.busy() // cadence(500 on, 500 off) — creates the first pair immediately
    expect(counts.oscillatorsCreated).toBe(2)

    // The visitor hangs up before the first cadence cycle's off-timer fires.
    tones.silence()

    // Without the fix, the off-timer scheduled by busy() fires here, stops
    // the (already-disconnected) oscillators, and schedules the next cycle
    // — restarting the busy signal after hangup. Advance well past several
    // on/off cycles and confirm nothing further was ever created.
    vi.advanceTimersByTime(10_000)
    expect(counts.oscillatorsCreated).toBe(2)
  })

  it("silence() actually stops oscillators it is still tracking, not just disconnects them", () => {
    const stopped: boolean[] = []
    const ctx: ToneContext = {
      destination: {},
      sampleRate: 44100,
      createOscillator: () => ({
        frequency: { value: 0 },
        connect: () => undefined,
        start: () => undefined,
        stop: () => { stopped.push(true) },
      }),
      createGain: () => ({ gain: { value: 0 }, connect: () => undefined, disconnect: () => undefined }),
      createBiquadFilter: fakeFilter,
      createBuffer: () => ({ getChannelData: () => new Float32Array(1) }),
      createBufferSource: () => ({ buffer: null, loop: false, connect: () => undefined, start: () => undefined, stop: () => undefined }),
    }

    const tones = new Tones(() => ctx)
    tones.dialTone()
    tones.silence()
    expect(stopped.length).toBe(2) // the 350 Hz + 440 Hz pair
  })

  it("data(true) starts a burble that data(false) stops, and does not auto-stop on its own", () => {
    const ctx: ToneContext = {
      destination: {},
      sampleRate: 44100,
      createOscillator: () => ({ frequency: { value: 0 }, connect: () => undefined, start: () => undefined, stop: () => undefined }),
      createGain: () => ({ gain: { value: 0 }, connect: () => undefined, disconnect: () => undefined }),
      createBiquadFilter: fakeFilter,
      createBuffer: () => ({ getChannelData: () => new Float32Array(1) }),
      createBufferSource: () => ({ buffer: null, loop: false, connect: () => undefined, start: () => undefined, stop: () => undefined }),
    }
    const tones = new Tones(() => ctx)
    tones.data(true)
    vi.advanceTimersByTime(60_000) // a full minute of dawdling with the handset up
    // No exception, no auto-stop assertion needed here beyond: still safe to
    // silence at any point.
    expect(() => tones.silence()).not.toThrow()
  })

  it("silence() cancels pending handshake-stage timers, so no stage fires after hangup", () => {
    const counts = { oscillatorsCreated: 0, noiseSourcesCreated: 0 }
    const stoppedOscillators: boolean[] = []
    const ctx: ToneContext = {
      destination: {},
      sampleRate: 44100,
      createOscillator: () => {
        counts.oscillatorsCreated++
        return {
          frequency: { value: 0 },
          connect: () => undefined,
          start: () => undefined,
          stop: () => { stoppedOscillators.push(true) },
        }
      },
      createGain: () => ({ gain: { value: 0 }, connect: () => undefined, disconnect: () => undefined }),
      createBiquadFilter: fakeFilter,
      createBuffer: () => ({ getChannelData: () => new Float32Array(1) }),
      createBufferSource: () => {
        counts.noiseSourcesCreated++
        return { buffer: null, loop: false, connect: () => undefined, start: () => undefined, stop: () => undefined }
      },
    }

    const tones = new Tones(() => ctx)
    const onTrained = vi.fn()
    tones.handshake(onTrained) // starts stage 1 (the answer tone) immediately
    expect(counts.oscillatorsCreated).toBe(1)

    // Hang up partway through stage 1, well before probing, training or the
    // data/scrambler burst would ever start.
    tones.silence()
    const createdAtHangup = counts.oscillatorsCreated
    const noiseAtHangup = counts.noiseSourcesCreated

    // Advance well past the full handshake's worst-case length (8s+). If any
    // stale stage timer survived silence(), it would create the probing
    // tones, the training noise/tone, or the scrambler burst here — and it
    // would call onTrained() a second time.
    vi.advanceTimersByTime(15_000)

    expect(counts.oscillatorsCreated).toBe(createdAtHangup)
    expect(counts.noiseSourcesCreated).toBe(noiseAtHangup)
    expect(onTrained).not.toHaveBeenCalled()
  })
})

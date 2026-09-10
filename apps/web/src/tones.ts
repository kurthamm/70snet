/** Western Electric call-progress tones, generated exactly.
 *
 *  A 300-baud Bell 103 connection is a STEADY TONE, not a sweep. The famous
 *  rising warble everyone associates with modems is V.32bis/V.34, from 1993,
 *  a decade after this room — see spec 7.1. Bell 103 is two modems each
 *  holding a steady mark/space pair at the other: 2225/2025 Hz from the
 *  answering modem, 1270/1070 Hz from the originating modem. Both carriers
 *  are on the line together, so the caller hears them beat against each
 *  other — a rough, dissonant two-tone — not a chirp that climbs in pitch.
 *
 *  These types describe only the slice of the WebAudio API this class uses.
 *  Production wires them to a real AudioContext (see `browserContext`
 *  below); tests inject a fake one, so this file needs no DOM to verify the
 *  timer bookkeeping below. */

export interface ToneAudioParam { value: number }

export interface ToneOscillator {
  frequency: ToneAudioParam
  connect(dest: unknown): unknown
  start(): void
  stop(): void
}

export interface ToneGain {
  gain: ToneAudioParam
  connect(dest: unknown): unknown
  disconnect(): void
}

export interface ToneAudioBuffer {
  getChannelData(channel: number): Float32Array
}

export interface ToneBufferSource {
  buffer: ToneAudioBuffer | null
  loop: boolean
  connect(dest: unknown): unknown
  start(): void
  stop(): void
}

export interface ToneContext {
  readonly destination: unknown
  readonly sampleRate: number
  createOscillator(): ToneOscillator
  createGain(): ToneGain
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): ToneAudioBuffer
  createBufferSource(): ToneBufferSource
}

function browserContext(): ToneContext {
  // The real AudioContext satisfies ToneContext structurally; this is the
  // one place that boundary is asserted, so production code gets the real
  // API and tests can inject a fake one without touching a DOM.
  return new AudioContext() as unknown as ToneContext
}

export class Tones {
  private ctx: ToneContext | null = null
  private nodes: ToneGain[] = []
  private running: (ToneOscillator | ToneBufferSource)[] = []
  private timers: ReturnType<typeof setTimeout>[] = []
  private generation = 0

  private dataTimer: ReturnType<typeof setInterval> | null = null
  private dataOsc: ToneOscillator | null = null

  // Real oscillators drift a few Hz from nominal, and that drift is fixed
  // for the life of a call, not something that wanders mid-call. Pick it
  // once, per instance (i.e. per call).
  private readonly detuneHz = Math.random() * 6 - 3

  constructor(private readonly makeContext: () => ToneContext = browserContext) {}

  private context(): ToneContext {
    if (this.ctx === null) this.ctx = this.makeContext()
    return this.ctx
  }

  private pair(a: number, b: number, gain = 0.12): ToneOscillator[] {
    const ctx = this.context()
    return [a, b].map(f => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.frequency.value = f
      g.gain.value = gain
      osc.connect(g)
      g.connect(ctx.destination)
      this.nodes.push(g)
      this.running.push(osc)
      return osc
    })
  }

  /** A short loop of white noise, filtered only by ear — authentic line
   *  hiss, not a synthesized whoosh. */
  private noise(gain: number): ToneBufferSource {
    const ctx = this.context()
    const length = Math.floor(ctx.sampleRate * 2)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(ctx.destination)
    this.nodes.push(g)
    this.running.push(src)
    return src
  }

  dialTone(): void { this.silence(); this.pair(350, 440).forEach(o => o.start()) }

  ringback(): void { this.cadence(() => this.pair(440, 480), 2000, 4000) }

  busy(): void { this.cadence(() => this.pair(480, 620), 500, 500) }

  /** Bell 103 answer tone alone. One frequency, no modulation. Kept for
   *  callers that just want the raw answer tone; `handshake()` is the full
   *  connect sequence. */
  carrier(): void { this.silence(); this.pair(2225, 2225, 0.06).forEach(o => o.start()) }

  /** The connect sequence: the far end's answer tone, then — a beat later —
   *  the originate carrier joining so both hold steady and beat against
   *  each other. Occasionally, authentically, the two sides fail to train
   *  and the line drops to no carrier; `onTrained` is how that gets told to
   *  the caller instead of being silently swallowed. */
  handshake(onTrained?: (trained: boolean) => void): void {
    this.silence()
    const gen = this.generation

    const answerFreq = 2225 + this.detuneHz
    const originateFreq = 1270 + this.detuneHz * 0.7

    this.pair(answerFreq, answerFreq, 0.06).forEach(o => o.start())

    const failsToTrain = Math.random() < 0.04
    const joinDelayMs = 400 + Math.random() * 300

    const joinTimer = setTimeout(() => {
      if (gen !== this.generation) return

      if (failsToTrain) {
        this.silence()
        onTrained?.(false)
        return
      }

      this.pair(originateFreq, originateFreq, 0.05).forEach(o => o.start())

      // Ambience for the rest of the call: faint hiss always, occasional
      // faint crosstalk from a neighbouring pair.
      this.noise(0.002 + Math.random() * 0.006).start()
      if (Math.random() < 0.3) {
        this.pair(1000 + Math.random() * 400, 1000 + Math.random() * 400, 0.004)
          .forEach(o => o.start())
      }

      onTrained?.(true)
    }, joinDelayMs)
    this.timers.push(joinTimer)
  }

  /** The FSK burble while bytes flow: the originate carrier shifting
   *  between mark (1270 Hz) and space (1070 Hz) at roughly 300 bits/second.
   *  Subtle — it sits under the call, not over it — and runs for as long as
   *  `active` stays true. Call `data(false)` when bytes stop; it does not
   *  stop on its own. */
  data(active: boolean): void {
    if (!active) {
      if (this.dataTimer !== null) { clearInterval(this.dataTimer); this.dataTimer = null }
      if (this.dataOsc !== null) {
        this.dataOsc.stop()
        this.running = this.running.filter(o => o !== this.dataOsc)
        this.dataOsc = null
      }
      return
    }
    if (this.dataTimer !== null) return // already burbling

    const ctx = this.context()
    const mark = 1270 + this.detuneHz
    const space = 1070 + this.detuneHz

    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.frequency.value = mark
    g.gain.value = 0.035
    osc.connect(g)
    g.connect(ctx.destination)
    this.nodes.push(g)
    this.running.push(osc)
    osc.start()
    this.dataOsc = osc

    const bitMs = 1000 / 300
    this.dataTimer = setInterval(() => {
      osc.frequency.value = Math.random() < 0.5 ? mark : space
    }, bitMs)
  }

  silence(): void {
    // Bumping the generation invalidates any cadence/handshake closures
    // already in flight; clearing the timers stops them from firing at
    // all. Both matter: a stale callback that already passed its
    // generation check but is mid-execution when silence() runs is rare
    // but not impossible, so belt and suspenders.
    this.generation++

    for (const t of this.timers) clearTimeout(t)
    this.timers = []

    if (this.dataTimer !== null) { clearInterval(this.dataTimer); this.dataTimer = null }
    this.dataOsc = null

    // Tracked rather than guarded: stopping an already-stopped oscillator
    // throws by specification, and an empty catch is forbidden here. Nodes
    // are removed from `running` the moment they're stopped elsewhere (see
    // `cadence` and `data`), so anything still in `running` here is still
    // actually running.
    for (const o of this.running) o.stop()
    for (const n of this.nodes) n.disconnect()
    this.running = []
    this.nodes = []
  }

  private cadence(make: () => ToneOscillator[], onMs: number, offMs: number): void {
    this.silence()
    const gen = this.generation

    const cycle = () => {
      if (gen !== this.generation) return // silence() ran since this was scheduled

      const oscs = make()
      oscs.forEach(o => o.start())

      const offTimer = setTimeout(() => {
        if (gen !== this.generation) return

        oscs.forEach(o => o.stop())
        const stoppedThisCycle: (ToneOscillator | ToneBufferSource)[] = oscs
        this.running = this.running.filter(o => !stoppedThisCycle.includes(o))

        const onTimer = setTimeout(() => {
          if (gen === this.generation) cycle()
        }, offMs)
        this.timers.push(onTimer)
      }, onMs)
      this.timers.push(offTimer)
    }

    cycle()
  }
}

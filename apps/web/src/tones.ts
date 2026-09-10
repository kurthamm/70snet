/** Western Electric call-progress tones, plus the connect handshake.
 *
 *  Historical note, and the decision on it: a real 1980 Bell 103 connection
 *  is a STEADY tone, not a sweep — the famous rising screech everyone
 *  associates with "a modem connecting" is V.32bis/V.34, from 1993, a decade
 *  after this room is set. `carrier()` below still generates the honest
 *  Bell 103 answer tone alone, for anyone who wants it. But the project
 *  owner has decided, deliberately, that `handshake()` should play the
 *  1990s negotiation screech instead, because that is what a visitor
 *  actually recognises as "a modem connecting." This is an approved
 *  anachronism. Do not revert it to steady Bell 103 tones.
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

export interface ToneBiquadFilter {
  type: string
  frequency: ToneAudioParam
  Q: ToneAudioParam
  connect(dest: unknown): unknown
  disconnect(): void
}

/** Anything the handshake stages create that needs disconnecting when a
 *  stage ends — a gain node or a filter node. */
type ToneDisconnectable = ToneGain | ToneBiquadFilter

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
  createBiquadFilter(): ToneBiquadFilter
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): ToneAudioBuffer
  createBufferSource(): ToneBufferSource
}

function browserContext(): ToneContext {
  // The real AudioContext satisfies ToneContext structurally; this is the
  // one place that boundary is asserted, so production code gets the real
  // API and tests can inject a fake one without touching a DOM.
  return new AudioContext() as unknown as ToneContext
}

/** Fisher-Yates, for randomising the probing-tone sequence per call. */
function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i] as T
    a[i] = a[j] as T
    a[j] = tmp
  }
  return a
}

export class Tones {
  private ctx: ToneContext | null = null
  private nodes: ToneDisconnectable[] = []
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

  /** A single tone: oscillator plus its own gain, both tracked in
   *  `running`/`nodes` (so a plain `silence()` always catches it) and also
   *  handed back so a handshake stage can stop precisely this tone when the
   *  stage ends, without tearing down everything else. */
  private makeTone(freq: number, gain: number): { osc: ToneOscillator; gain: ToneGain } {
    const ctx = this.context()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.frequency.value = freq
    g.gain.value = gain
    osc.connect(g)
    g.connect(ctx.destination)
    this.nodes.push(g)
    this.running.push(osc)
    return { osc, gain: g }
  }

  /** Two seconds of looping white noise, raw — the shared source buffer
   *  used both for authentic line hiss and for the handshake's filtered
   *  noise stages. */
  private makeNoiseSource(): ToneBufferSource {
    const ctx = this.context()
    const length = Math.floor(ctx.sampleRate * 2)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    return src
  }

  /** A short loop of white noise, filtered only by ear — authentic line
   *  hiss, not a synthesized whoosh. */
  private noise(gain: number): ToneBufferSource {
    const ctx = this.context()
    const src = this.makeNoiseSource()
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(ctx.destination)
    this.nodes.push(g)
    this.running.push(src)
    return src
  }

  /** Noise through a single bandpass filter — the "training" stage's
   *  warble, narrow-Q at first and widened over time by adjusting `filter`
   *  directly. `filters` is just `[filter]`, handed back so `stopStage` can
   *  disconnect it the same way it disconnects everything else. */
  private makeFilteredNoise(
    gain: number, centerFreq: number, q: number,
  ): { src: ToneBufferSource; gainNode: ToneGain; filter: ToneBiquadFilter; filters: ToneBiquadFilter[] } {
    const ctx = this.context()
    const src = this.makeNoiseSource()
    const filter = ctx.createBiquadFilter()
    filter.type = "bandpass"
    filter.frequency.value = centerFreq
    filter.Q.value = q
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(filter)
    filter.connect(g)
    g.connect(ctx.destination)
    this.nodes.push(g, filter)
    this.running.push(src)
    return { src, gainNode: g, filter, filters: [filter] }
  }

  /** Noise through a highpass+lowpass pair, limiting it to telephone
   *  bandwidth — the "data/scrambler" burst. */
  private makeBandlimitedNoise(
    gain: number, lowHz: number, highHz: number,
  ): { src: ToneBufferSource; gainNode: ToneGain; filters: ToneBiquadFilter[] } {
    const ctx = this.context()
    const src = this.makeNoiseSource()
    const hp = ctx.createBiquadFilter()
    hp.type = "highpass"
    hp.frequency.value = lowHz
    const lp = ctx.createBiquadFilter()
    lp.type = "lowpass"
    lp.frequency.value = highHz
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(hp)
    hp.connect(lp)
    lp.connect(g)
    g.connect(ctx.destination)
    this.nodes.push(g, hp, lp)
    this.running.push(src)
    return { src, gainNode: g, filters: [hp, lp] }
  }

  /** Stops exactly the given oscillators/sources and disconnects exactly
   *  the given nodes, and untracks them — used to end one handshake stage
   *  without touching whatever the next stage is about to start. A plain
   *  `silence()` remains the blanket safety net: it still stops and
   *  disconnects everything still tracked, whatever stage it catches. */
  private stopStage(playing: (ToneOscillator | ToneBufferSource)[], nodes: ToneDisconnectable[]): void {
    for (const o of playing) o.stop()
    for (const n of nodes) n.disconnect()
    this.running = this.running.filter(o => !playing.includes(o))
    this.nodes = this.nodes.filter(n => !nodes.includes(n))
  }

  dialTone(): void { this.silence(); this.pair(350, 440).forEach(o => o.start()) }

  ringback(): void { this.cadence(() => this.pair(440, 480), 2000, 4000) }

  busy(): void { this.cadence(() => this.pair(480, 620), 500, 500) }

  /** Bell 103 answer tone alone. One frequency, no modulation, no
   *  negotiation. The historically accurate sound — kept as a primitive,
   *  but `handshake()` is what actually plays on connect now. */
  carrier(): void { this.silence(); this.pair(2225, 2225, 0.06).forEach(o => o.start()) }

  /** The connect sequence: a V.32bis/V.34-style negotiation ritual, the
   *  screech everyone recognises as "a modem connecting" (see the file
   *  header — this is a deliberate anachronism for a 1980-set room).
   *  Stages, back to back:
   *
   *   1. Answer tone: ~2100 Hz, 1.5-2.5s, with a click every ~450ms (a
   *      brief gain dip) standing in for the phase reversals that disabled
   *      echo cancellers on the real thing.
   *   2. Probing/ranging tones: a randomised handful of discrete tones
   *      across 300-3000 Hz, 80-200ms each — the "doo-doo-dee" part.
   *   3. Training: bandpass-filtered noise plus a warbling tone, ~1.4-1.9s,
   *      with the band widening (filter Q dropping) over several steps.
   *   4. Data/scrambler: a loud burst of noise bandlimited to telephone
   *      bandwidth (300-3400 Hz), ~1-1.5s — the "shhhhhh" climax.
   *   5. Silence: everything stops. On a real modem, the sound stopping is
   *      how you knew you were connected, so this is not optional.
   *
   *  Occasionally, authentically, negotiation fails partway through
   *  training and the line drops to no carrier; `onTrained` is how that's
   *  told to the caller instead of being silently swallowed. */
  handshake(onTrained?: (trained: boolean) => void): void {
    this.silence()
    const gen = this.generation

    const schedule = (ms: number, fn: () => void): void => {
      const t = setTimeout(() => { if (gen === this.generation) fn() }, ms)
      this.timers.push(t)
    }

    const failsToTrain = Math.random() < 0.04
    const noiseLevel = 0.05 + Math.random() * 0.04 // randomised per call

    // ---- Stage 1: answer tone, with periodic "phase inversion" clicks ----
    const ANSWER_GAIN = 0.07
    const answerFreq = 2100 + this.detuneHz
    const answerDurationMs = 1500 + Math.random() * 1000 // 1.5-2.5s
    const { osc: answerOsc, gain: answerGain } = this.makeTone(answerFreq, ANSWER_GAIN)
    answerOsc.start()

    const CLICK_INTERVAL_MS = 450
    const CLICK_DIP_MS = 20
    for (let t = CLICK_INTERVAL_MS; t < answerDurationMs; t += CLICK_INTERVAL_MS) {
      schedule(t, () => { answerGain.gain.value = 0.001 })
      schedule(t + CLICK_DIP_MS, () => { answerGain.gain.value = ANSWER_GAIN })
    }
    schedule(answerDurationMs, () => this.stopStage([answerOsc], [answerGain]))

    // ---- Stage 2: probing/ranging tones, "doo-doo-dee" ----
    const PROBE_POOL = [300, 500, 700, 900, 1100, 1300, 1600, 1900, 2200, 2500, 2800, 3000]
    const PROBE_GAIN = 0.06
    const PROBE_GAP_MS = 15
    const probeCount = 6 + Math.floor(Math.random() * 4) // 6-9 tones, randomised per call
    const probeSeq = shuffled(PROBE_POOL).slice(0, probeCount)

    let probeOffset = answerDurationMs
    for (const freq of probeSeq) {
      const duration = 80 + Math.random() * 120 // 80-200ms
      const start = probeOffset
      schedule(start, () => {
        const { osc, gain } = this.makeTone(freq + this.detuneHz, PROBE_GAIN)
        osc.start()
        schedule(duration, () => this.stopStage([osc], [gain]))
      })
      probeOffset += duration + PROBE_GAP_MS
    }
    const probingEndMs = probeOffset

    // ---- Stage 3: training — bandpass noise + warbling tone, band widening
    const trainingStartMs = probingEndMs
    const trainingDurationMs = 1400 + Math.random() * 500 // 1.4-1.9s
    const TRAIN_STEPS = 5
    const stepMs = trainingDurationMs / TRAIN_STEPS
    const trainCenter = 1700 + this.detuneHz

    let trainNoise: { src: ToneBufferSource; gainNode: ToneGain; filter: ToneBiquadFilter; filters: ToneBiquadFilter[] } | null = null
    let trainTone: { osc: ToneOscillator; gain: ToneGain } | null = null

    schedule(trainingStartMs, () => {
      trainNoise = this.makeFilteredNoise(noiseLevel, trainCenter, 8)
      trainNoise.src.start()
      trainTone = this.makeTone(trainCenter, 0.04)
      trainTone.osc.start()
    })

    for (let i = 1; i <= TRAIN_STEPS; i++) {
      const at = trainingStartMs + stepMs * i
      const q = Math.max(1, 8 - i * 1.5) // widening band as training proceeds
      const center = trainCenter + (Math.random() * 400 - 200)
      schedule(at, () => {
        if (trainNoise !== null) {
          trainNoise.filter.frequency.value = center
          trainNoise.filter.Q.value = q
        }
        if (trainTone !== null) trainTone.osc.frequency.value = center
      })
    }

    // Occasionally, authentically, the two sides fail to train partway
    // through and the line drops to no carrier — not silently, `onTrained`
    // tells the caller. Decided once, up front, so it's this call's fate
    // from the start rather than a decision made mid-stage.
    if (failsToTrain) {
      const failAtMs = trainingStartMs + trainingDurationMs * (0.4 + Math.random() * 0.35)
      schedule(failAtMs, () => {
        this.silence()
        onTrained?.(false)
      })
      return
    }

    schedule(trainingStartMs + trainingDurationMs, () => {
      if (trainNoise !== null) this.stopStage([trainNoise.src], [trainNoise.gainNode, ...trainNoise.filters])
      if (trainTone !== null) this.stopStage([trainTone.osc], [trainTone.gain])
    })

    // ---- Stage 4: data/scrambler — loud noise, bandlimited to telephone bandwidth
    const dataStageStartMs = trainingStartMs + trainingDurationMs
    const dataStageDurationMs = 1000 + Math.random() * 500 // 1-1.5s
    const scramblerGain = 0.09 + Math.random() * 0.05 // randomised noise level

    let scrambler: { src: ToneBufferSource; gainNode: ToneGain; filters: ToneBiquadFilter[] } | null = null
    schedule(dataStageStartMs, () => {
      scrambler = this.makeBandlimitedNoise(scramblerGain, 300, 3400)
      scrambler.src.start()
    })

    // ---- Stage 5: silence — connected, and the speaker mutes ----
    schedule(dataStageStartMs + dataStageDurationMs, () => {
      if (scrambler !== null) this.stopStage([scrambler.src], [scrambler.gainNode, ...scrambler.filters])
      onTrained?.(true)
    })
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
    // `cadence`, `data` and `stopStage`), so anything still in `running`
    // here is still actually running.
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

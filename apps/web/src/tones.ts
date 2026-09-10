/** Western Electric call-progress tones, generated exactly.
 *
 *  A 300-baud Bell 103 connection is a STEADY TONE. The warbling handshake is
 *  V.32, a decade after this room — see spec 7.1. */
export class Tones {
  private ctx: AudioContext | null = null
  private nodes: AudioNode[] = []
  private running: OscillatorNode[] = []

  private pair(a: number, b: number, gain = 0.12): OscillatorNode[] {
    const ctx = this.context()
    return [a, b].map(f => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.frequency.value = f
      g.gain.value = gain
      osc.connect(g).connect(ctx.destination)
      this.nodes.push(osc, g)
      return osc
    })
  }

  private context(): AudioContext {
    if (this.ctx === null) this.ctx = new AudioContext()
    return this.ctx
  }

  dialTone(): void { this.silence(); this.pair(350, 440).forEach(o => o.start()) }

  ringback(): void { this.cadence(() => this.pair(440, 480), 2000, 4000) }

  busy(): void { this.cadence(() => this.pair(480, 620), 500, 500) }

  /** Bell 103 answer tone. One frequency, no modulation. */
  carrier(): void { this.silence(); this.pair(2225, 2225, 0.06).forEach(o => o.start()) }

  silence(): void {
    // Tracked rather than guarded: stopping an already-stopped oscillator
    // throws by specification, and an empty catch is forbidden here.
    for (const o of this.running) o.stop()
    for (const n of this.nodes) n.disconnect()
    this.running = []
    this.nodes = []
  }

  private cadence(make: () => OscillatorNode[], onMs: number, offMs: number): void {
    this.silence()
    const cycle = () => {
      const oscs = make()
      oscs.forEach(o => o.start())
      setTimeout(() => { oscs.forEach(o => o.stop()); setTimeout(cycle, offMs) }, onMs)
    }
    cycle()
  }
}

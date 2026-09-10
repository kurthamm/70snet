/** Releases bytes at a fixed line speed, one character at a time.
 *
 *  300 baud with 8N1 framing is 10 bits per character, so 30 characters per
 *  second — 33.333ms each. The waiting is the point (spec §7.5); do not batch
 *  and do not "catch up" after a stall. */
export class BaudPacer {
  private queue: number[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  // Deadlines are computed as ceil((n * msNumerator) / bitsPerSecond) rather
  // than from a pre-divided "ms per char" float. A fixed fractional interval
  // (e.g. 300 baud, 10 bits/char = 33.333...ms) cannot be handed to
  // setInterval/setTimeout directly: both Node and fake timers truncate a
  // fractional delay to whole milliseconds, so a naive setInterval(fn,
  // 33.333) fires its first tick at 33ms, not 34ms, and then drifts out of
  // sync with true 300-baud timing over a long run. Keeping the numerator and
  // denominator separate (instead of pre-dividing into a float) also avoids
  // floating-point rounding error compounding across many characters — e.g.
  // 30 * (10*1000/300) rounds to slightly over 1000 in IEEE 754, which would
  // push the 30th character's deadline to 1001ms instead of the true 1000.
  private readonly msNumerator: number
  private readonly bitsPerSecond: number
  // Count of characters whose delivery has been scheduled in the current run.
  private charsScheduled = 0

  constructor(
    bitsPerSecond: number,
    bitsPerChar: number,
    private readonly sink: (bytes: Uint8Array) => void,
  ) {
    if (bitsPerSecond <= 0) throw new Error(`bitsPerSecond must be positive, got ${bitsPerSecond}`)
    if (bitsPerChar <= 0) throw new Error(`bitsPerChar must be positive, got ${bitsPerChar}`)
    this.bitsPerSecond = bitsPerSecond
    this.msNumerator = bitsPerChar * 1000
  }

  get pending(): number {
    return this.queue.length
  }

  push(bytes: Uint8Array): void {
    for (const b of bytes) this.queue.push(b)
    this.ensureRunning()
  }

  stop(): void {
    this.queue.length = 0
    this.charsScheduled = 0
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private ensureRunning(): void {
    if (this.timer !== null) return
    this.charsScheduled = 0
    this.scheduleNext()
  }

  private deadline(n: number): number {
    return Math.ceil((n * this.msNumerator) / this.bitsPerSecond)
  }

  private scheduleNext(): void {
    const n = this.charsScheduled + 1
    const delay = this.deadline(n) - this.deadline(n - 1)

    this.timer = setTimeout(() => {
      this.timer = null
      const b = this.queue.shift()
      if (b === undefined) {
        this.charsScheduled = 0
        return
      }
      this.charsScheduled = n
      this.sink(new Uint8Array([b]))
      if (this.queue.length > 0) this.scheduleNext()
    }, delay)
  }
}

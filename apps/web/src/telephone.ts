import type { ServerMessage } from "@70snet/protocol/client"

const PULSE_MS = 100        // 10 pulses per second
const INTERDIGIT_MS = 700

export type PhoneState =
  | "on-hook" | "dial-tone" | "dialing" | "dialled"
  | "ringing" | "busy" | "connected" | "no-answer"

export interface TonePlayer {
  dialTone(): void; ringback(): void; busy(): void
  carrier(): void; silence(): void
}

export class Telephone {
  private _state: PhoneState = "on-hook"

  constructor(private readonly opts: {
    tones: TonePlayer
    dialing: "manual" | "hayes-at"
  }) {}

  get state(): PhoneState { return this._state }

  lift(): void {
    this._state = "dial-tone"
    this.opts.tones.dialTone()
  }

  replace(): void {
    this._state = "on-hook"
    this.opts.tones.silence()
  }

  /** One digit, at the speed a rotary dial actually returned. */
  async dial(digit: string): Promise<void> {
    if (this._state === "on-hook") throw new Error("cannot dial: the handset is down")
    const n = digit === "0" ? 10 : Number(digit)
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error(`not a dialable digit: ${digit}`)

    this._state = "dialing"
    this.opts.tones.silence()
    await sleep(n * PULSE_MS + INTERDIGIT_MS)
    this._state = "dialled"
  }

  async dialNumber(number: string): Promise<void> {
    if (this.opts.dialing === "hayes-at") {
      // 1981+: the modem dials itself and there is no handset in the loop.
      this._state = "dialled"
      return
    }
    for (const ch of number.replace(/[^0-9]/g, "")) await this.dial(ch)
  }

  /** What the caller hears back from the exchange. */
  hear(msg: ServerMessage): void {
    switch (msg.kind) {
      case "ringing":        this._state = "ringing"; this.opts.tones.ringback(); break
      case "busy":           this._state = "busy"; this.opts.tones.busy(); break
      case "no-answer":      this._state = "no-answer"; this.opts.tones.ringback(); break
      case "connected":      this._state = "connected"; this.opts.tones.carrier(); break
      case "carrier-lost":   this._state = "on-hook"; this.opts.tones.silence(); break
      case "out-of-service": this._state = "no-answer"; this.opts.tones.silence(); break
    }
  }
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms))

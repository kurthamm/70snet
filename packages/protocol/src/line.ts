/** One event on a telephone line. Data frames carry opaque octets: nothing in
 *  the path understands what CBBS is saying. */
export type LineFrame =
  | { type: "data"; bytes: Uint8Array }
  | { type: "ring" }
  | { type: "carrier"; on: boolean }
  | { type: "offhook"; on: boolean }

const DATA = 0x01
const RING = 0x02
const CARRIER = 0x03
const OFFHOOK = 0x04

const HEADER = 3 // type u8 + length u16be
const MAX_PAYLOAD = 0xffff

export class FramePayloadTooLargeError extends Error {
  constructor(length: number) {
    super(`line frame payload of ${length} bytes exceeds the 16-bit length header limit of ${MAX_PAYLOAD} bytes`)
    this.name = "FramePayloadTooLargeError"
  }
}

export class MalformedControlFramePayloadError extends Error {
  constructor(frame: "ring" | "carrier" | "offhook", detail: string) {
    super(`malformed ${frame} frame payload: ${detail}`)
    this.name = "MalformedControlFramePayloadError"
  }
}

export function encodeFrame(frame: LineFrame): Uint8Array {
  const payload =
    frame.type === "data" ? frame.bytes
    : frame.type === "ring" ? new Uint8Array(0)
    : new Uint8Array([frame.on ? 1 : 0])

  if (payload.length > MAX_PAYLOAD) {
    throw new FramePayloadTooLargeError(payload.length)
  }

  const type =
    frame.type === "data" ? DATA
    : frame.type === "ring" ? RING
    : frame.type === "carrier" ? CARRIER
    : OFFHOOK

  const out = new Uint8Array(HEADER + payload.length)
  out[0] = type
  out[1] = (payload.length >> 8) & 0xff
  out[2] = payload.length & 0xff
  out.set(payload, HEADER)
  return out
}

export function decodeFrames(buf: Uint8Array): { frames: LineFrame[]; rest: Uint8Array } {
  const frames: LineFrame[] = []
  let i = 0

  while (i + HEADER <= buf.length) {
    const type = buf[i]!
    const len = (buf[i + 1]! << 8) | buf[i + 2]!
    if (i + HEADER + len > buf.length) break // partial; wait for more

    const payload = buf.subarray(i + HEADER, i + HEADER + len)
    switch (type) {
      case DATA:
        frames.push({ type: "data", bytes: new Uint8Array(payload) })
        break
      case RING:
        if (len !== 0) {
          throw new MalformedControlFramePayloadError("ring", `expected 0 bytes, got ${len}`)
        }
        frames.push({ type: "ring" })
        break
      case CARRIER:
      case OFFHOOK: {
        const name = type === CARRIER ? "carrier" : "offhook"
        if (len !== 1 || (payload[0] !== 0 && payload[0] !== 1)) {
          throw new MalformedControlFramePayloadError(
            name,
            `expected exactly 1 byte valued 0 or 1, got ${len} byte${len === 1 ? "" : "s"}` +
              (len === 1 ? ` valued ${payload[0]}` : "")
          )
        }
        frames.push({ type: name, on: payload[0] === 1 })
        break
      }
      default:
        throw new Error(`unknown line frame type 0x${type.toString(16)}`)
    }
    i += HEADER + len
  }

  return { frames, rest: buf.subarray(i) }
}

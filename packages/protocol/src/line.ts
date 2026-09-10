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

export function encodeFrame(frame: LineFrame): Uint8Array {
  const payload =
    frame.type === "data" ? frame.bytes
    : frame.type === "ring" ? new Uint8Array(0)
    : new Uint8Array([frame.on ? 1 : 0])

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
      case DATA: frames.push({ type: "data", bytes: new Uint8Array(payload) }); break
      case RING: frames.push({ type: "ring" }); break
      case CARRIER: frames.push({ type: "carrier", on: payload[0] === 1 }); break
      case OFFHOOK: frames.push({ type: "offhook", on: payload[0] === 1 }); break
      default:
        throw new Error(`unknown line frame type 0x${type.toString(16)}`)
    }
    i += HEADER + len
  }

  return { frames, rest: buf.subarray(i) }
}

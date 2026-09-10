import { describe, it, expect } from "vitest"
import {
  encodeFrame,
  decodeFrames,
  FramePayloadTooLargeError,
  MalformedControlFramePayloadError,
  type LineFrame,
} from "./line"

describe("line frame codec", () => {
  it("round-trips a data frame", () => {
    const f: LineFrame = { type: "data", bytes: new Uint8Array([0x48, 0x49]) }
    const { frames, rest } = decodeFrames(encodeFrame(f))
    expect(frames).toEqual([f])
    expect(rest.length).toBe(0)
  })

  it("round-trips signalling frames", () => {
    const fs: LineFrame[] = [
      { type: "ring" },
      { type: "carrier", on: true },
      { type: "carrier", on: false },
      { type: "offhook", on: true },
    ]
    const buf = new Uint8Array(fs.flatMap(f => [...encodeFrame(f)]))
    expect(decodeFrames(buf).frames).toEqual(fs)
  })

  it("returns a partial trailing frame as rest, not a guess", () => {
    const whole = encodeFrame({ type: "data", bytes: new Uint8Array([1, 2, 3]) })
    const { frames, rest } = decodeFrames(whole.slice(0, whole.length - 1))
    expect(frames).toEqual([])
    expect(rest.length).toBe(whole.length - 1)
  })

  it("throws on an unknown frame type rather than skipping it", () => {
    expect(() => decodeFrames(new Uint8Array([0x7f, 0x00, 0x00])))
      .toThrow(/unknown line frame type 0x7f/)
  })

  it("rejects a data payload too long for the 16-bit length header instead of silently wrapping it", () => {
    const oversized = { type: "data", bytes: new Uint8Array(0x10000) } as const
    expect(() => encodeFrame(oversized)).toThrow(FramePayloadTooLargeError)
    expect(() => encodeFrame(oversized)).toThrow(/exceeds the 16-bit length header limit/)
  })

  it("accepts a payload exactly at the 16-bit length header limit", () => {
    const maxed: LineFrame = { type: "data", bytes: new Uint8Array(0xffff) }
    const { frames, rest } = decodeFrames(encodeFrame(maxed))
    expect(frames).toEqual([maxed])
    expect(rest.length).toBe(0)
  })

  it("rejects a ring frame carrying a payload instead of ignoring it", () => {
    // type=0x02 (ring), length=1, one stray payload byte.
    expect(() => decodeFrames(new Uint8Array([0x02, 0x00, 0x01, 0x00])))
      .toThrow(MalformedControlFramePayloadError)
    expect(() => decodeFrames(new Uint8Array([0x02, 0x00, 0x01, 0x00])))
      .toThrow(/malformed ring frame payload/)
  })

  it("rejects a carrier frame with the wrong payload length", () => {
    // type=0x03 (carrier), length=0.
    expect(() => decodeFrames(new Uint8Array([0x03, 0x00, 0x00])))
      .toThrow(MalformedControlFramePayloadError)
  })

  it("rejects a carrier or offhook frame with a payload byte other than 0 or 1", () => {
    // type=0x03 (carrier), length=1, payload byte 0x02.
    expect(() => decodeFrames(new Uint8Array([0x03, 0x00, 0x01, 0x02])))
      .toThrow(MalformedControlFramePayloadError)
    // type=0x04 (offhook), length=1, payload byte 0xff.
    expect(() => decodeFrames(new Uint8Array([0x04, 0x00, 0x01, 0xff])))
      .toThrow(MalformedControlFramePayloadError)
  })

  it("still accepts well-formed carrier/offhook frames after the stricter check", () => {
    // type=0x03 (carrier), length=1, payload byte 0x00 ("off").
    const { frames } = decodeFrames(new Uint8Array([0x03, 0x00, 0x01, 0x00]))
    expect(frames).toEqual([{ type: "carrier", on: false }])
  })
})

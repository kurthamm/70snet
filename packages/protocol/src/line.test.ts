import { describe, it, expect } from "vitest"
import { encodeFrame, decodeFrames, FramePayloadTooLargeError, type LineFrame } from "./line"

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
})

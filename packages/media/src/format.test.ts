import { describe, it, expect } from "vitest"
import { validateImage, UnidentifiableImageError } from "./format"

describe("validating an uploaded image by kind", () => {
  it("accepts a 5.25\" disk image of exactly 143,360 bytes", () => {
    const bytes = new Uint8Array(143360)
    expect(() => validateImage(bytes, "diskette-5.25")).not.toThrow()
  })

  it("accepts a .woz image identified by its WOZ1 header", () => {
    const bytes = new Uint8Array(16)
    bytes.set([0x57, 0x4f, 0x5a, 0x31, 0xff, 0x0a, 0x0d, 0x0a])
    expect(() => validateImage(bytes, "diskette-5.25")).not.toThrow()
  })

  it("accepts a .woz image identified by its WOZ2 header", () => {
    const bytes = new Uint8Array(16)
    bytes.set([0x57, 0x4f, 0x5a, 0x32, 0xff, 0x0a, 0x0d, 0x0a])
    expect(() => validateImage(bytes, "diskette-5.25")).not.toThrow()
  })

  it("rejects a 5.25\" image of the wrong size with a named, specific error", () => {
    const bytes = new Uint8Array(143359)
    expect(() => validateImage(bytes, "diskette-5.25")).toThrow(UnidentifiableImageError)
    try {
      validateImage(bytes, "diskette-5.25")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(UnidentifiableImageError)
      expect((e as Error).message).toMatch(/143,360 bytes/)
      expect((e as Error).message).toMatch(/WOZ/)
    }
  })

  it("rejects a WOZ header with a corrupted trailer without half-loading it", () => {
    const bytes = new Uint8Array(16)
    bytes.set([0x57, 0x4f, 0x5a, 0x31, 0x00, 0x00, 0x00, 0x00])
    expect(() => validateImage(bytes, "diskette-5.25")).toThrow(UnidentifiableImageError)
  })

  it("throws when no validator is defined for the kind, rather than accepting silently", () => {
    const bytes = new Uint8Array(1)
    expect(() => validateImage(bytes, "cartridge")).toThrow(UnidentifiableImageError)
  })
})

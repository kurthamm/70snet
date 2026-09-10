import { describe, it, expect } from "vitest"
import { isClientMessage } from "./server"

/** Pure runtime validation, tested without booting the emulator: this is
 *  what stands between a malformed frame and an unguarded `JSON.parse`
 *  result being trusted as a `ClientMessage` (see the CRITICAL fix in
 *  server.ts's `ws.on("message", ...)` handler). */
describe("isClientMessage", () => {
  it("accepts a well-formed dial message", () => {
    expect(isClientMessage({ kind: "dial", number: "312-555-0100" })).toBe(true)
  })

  it("accepts a well-formed hangup message", () => {
    expect(isClientMessage({ kind: "hangup" })).toBe(true)
  })

  it("rejects a dial message whose number is not a string", () => {
    expect(isClientMessage({ kind: "dial", number: 5551000 })).toBe(false)
  })

  it("rejects a dial message missing its number", () => {
    expect(isClientMessage({ kind: "dial" })).toBe(false)
  })

  it("rejects an unrecognized kind", () => {
    expect(isClientMessage({ kind: "ring" })).toBe(false)
  })

  it("rejects primitives and null, the shapes a parsed garbage frame can take", () => {
    expect(isClientMessage(null)).toBe(false)
    expect(isClientMessage(42)).toBe(false)
    expect(isClientMessage("dial")).toBe(false)
    expect(isClientMessage([])).toBe(false)
  })
})

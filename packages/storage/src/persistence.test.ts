import { describe, it, expect } from "vitest"
import { describeDurability } from "./persistence"

describe("describeDurability", () => {
  it("resolving true means exempt from eviction", async () => {
    const d = await describeDurability({ persist: async () => true, estimate: async () => ({}) })
    expect(d).toBe("persistent")
  })

  it("persist() resolving false is NOT storage being unavailable", async () => {
    const d = await describeDurability({ persist: async () => false, estimate: async () => ({}) })
    expect(d).toBe("evictable")
  })

  it("a missing storage API is still usable, just evictable", async () => {
    expect(await describeDurability(undefined)).toBe("evictable")
  })

  it("reports unavailable when IndexedDB itself throws", async () => {
    const throwingManager = {
      persist: async () => {
        throw new Error("IndexedDB is disabled in this browsing context")
      },
      estimate: async () => ({}),
    }
    expect(await describeDurability(throwingManager)).toBe("unavailable")
  })
})

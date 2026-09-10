import { describe, it, expect } from "vitest"
import { eraFor, eraKeyFor, phoneBook } from "./destination"
import { CBBS, DESTINATIONS } from "./data/destinations"
import { ROOM_1980, ROOM_1977 } from "./data/rooms"

describe("destination eras", () => {
  it("resolves the era alive in a given year", () => {
    const era = eraFor(CBBS, ROOM_1980.date)
    expect(era?.lines).toBe(1)
    expect(era?.speeds).toEqual([300])
  })

  it("returns null before the destination existed", () => {
    expect(eraFor(CBBS, "1977-06-01")).toBeNull()
  })

  it("keys occupancy by destination AND era, per spec 5.5", () => {
    const k1980 = eraKeyFor(CBBS, "1980-10-01")
    const k1983 = eraKeyFor(CBBS, "1983-06-01")
    expect(k1980).not.toBeNull()
    expect(k1980).not.toEqual(k1983)
  })

  it("the 1977 room has an empty phone book with no special case", () => {
    // CBBS opens February 1978. Nothing in the code says "1977 is empty";
    // the lifespan rule produces it. Spec 13.
    expect(phoneBook(DESTINATIONS, ROOM_1977.date)).toEqual([])
  })

  it("the 1980 room reaches CBBS", () => {
    const book = phoneBook(DESTINATIONS, ROOM_1980.date)
    expect(book.map(e => e.name)).toContain("CBBS")
    expect(book[0]!.fidelity).toBe("real-software")
  })

  it("returns a phone book entry whose speeds array is a copy, not a shared reference to the registry's era", () => {
    const era = eraFor(CBBS, ROOM_1980.date)!
    const book = phoneBook(DESTINATIONS, ROOM_1980.date)
    const entry = book.find(e => e.name === "CBBS")!

    expect(entry.speeds).not.toBe(era.speeds)

    entry.speeds.push(9999)
    expect(era.speeds).not.toContain(9999)
    expect(eraFor(CBBS, ROOM_1980.date)!.speeds).not.toContain(9999)
  })
})

import { describe, it, expect } from "vitest"
import { visibleIn } from "./box"
import type { Medium } from "./medium"

const disk = (id: string, acquired: string): Medium => ({
  id, kind: "diskette-5.25", format: "dsk", label: id,
  acquired, writeProtected: false, provenance: "curated",
})

describe("what the visitor can see", () => {
  it("shows only what they owned by the room's date", () => {
    const box = [disk("dos33", "1980-08-01"), disk("later", "1983-06-01")]
    expect(visibleIn(box, "1980-10-01").map(m => m.id)).toEqual(["dos33"])
  })

  it("shows everything by a later room's date", () => {
    const box = [disk("dos33", "1980-08-01"), disk("later", "1983-06-01")]
    expect(visibleIn(box, "1983-06-01").map(m => m.id)).toEqual(["dos33", "later"])
  })

  it("shows an undated upload in every room", () => {
    // The visitor did not tell us the year, so it cannot be filtered by one.
    const box = [disk("mystery", "undated")]
    expect(visibleIn(box, "1977-06-01")).toHaveLength(1)
    expect(visibleIn(box, "1983-06-01")).toHaveLength(1)
  })
})

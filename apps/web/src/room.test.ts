import { describe, it, expect } from "vitest"
import { renderRoom, toApple } from "./room"
import { ROOM_1980 } from "@70snet/registry/data/rooms"
import { DESTINATIONS } from "@70snet/registry/data/destinations"

describe("the 1980 room", () => {
  it("renders from room data, not hardcoded machines", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    expect(el.querySelectorAll("[data-machine]").length).toBe(ROOM_1980.machines.length)
  })

  it("shows the museum card explaining the empty drive", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    expect(el.textContent).toContain("There is no software in the machine")
  })

  it("labels every phone book entry with its fidelity", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    const entries = [...el.querySelectorAll("[data-phonebook-entry]")]
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect(e.getAttribute("data-fidelity")).toBeTruthy()
  })

  it("uppercases what the visitor types, because the II+ had no lowercase", () => {
    expect(toApple("hello")).toBe("HELLO")
  })
})

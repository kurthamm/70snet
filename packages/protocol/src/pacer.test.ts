import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BaudPacer } from "./pacer"

describe("BaudPacer", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("delivers 30 characters per second at 300 baud, 8N1", () => {
    const got: number[] = []
    const p = new BaudPacer(300, 10, b => got.push(...b))
    p.push(new Uint8Array(60).fill(0x41))

    vi.advanceTimersByTime(1000)
    expect(got.length).toBe(30)

    vi.advanceTimersByTime(1000)
    expect(got.length).toBe(60)
  })

  it("delivers nothing before the first character time has elapsed", () => {
    const got: number[] = []
    const p = new BaudPacer(300, 10, b => got.push(...b))
    p.push(new Uint8Array([0x41]))

    vi.advanceTimersByTime(33)
    expect(got.length).toBe(0)
    vi.advanceTimersByTime(1)
    expect(got.length).toBe(1)
  })

  it("preserves order across separate pushes", () => {
    const got: number[] = []
    const p = new BaudPacer(300, 10, b => got.push(...b))
    p.push(new Uint8Array([1, 2]))
    vi.advanceTimersByTime(34)
    p.push(new Uint8Array([3]))
    vi.advanceTimersByTime(1000)
    expect(got).toEqual([1, 2, 3])
  })

  it("stop() discards pending bytes — a dropped carrier loses them", () => {
    const got: number[] = []
    const p = new BaudPacer(300, 10, b => got.push(...b))
    p.push(new Uint8Array(30))
    vi.advanceTimersByTime(100)
    const delivered = got.length
    p.stop()
    vi.advanceTimersByTime(5000)
    expect(got.length).toBe(delivered)
    expect(p.pending).toBe(0)
  })
})

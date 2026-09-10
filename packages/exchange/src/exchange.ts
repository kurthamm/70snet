import { eraFor, eraKeyFor, type Destination } from "@70snet/registry/destination"
import type { HostRegistry, LineInterface } from "./line"

export type DialOutcome =
  | { outcome: "busy" }
  | { outcome: "no-answer" }
  | { outcome: "out-of-service"; reason: string }
  | { outcome: "connected"; eraKey: string; baud: number; line: LineInterface }

interface Call {
  eraKey: string
  line: LineInterface
  abort: AbortController
}

export class Exchange {
  private readonly destinations: Destination[]
  private readonly hosts: HostRegistry
  private readonly calls = new Map<string, Call>()
  private readonly busyLines = new Map<string, number>()

  constructor(opts: { destinations: Destination[]; hosts: HostRegistry }) {
    this.destinations = opts.destinations
    this.hosts = opts.hosts
  }

  occupancy(eraKey: string): number {
    return this.busyLines.get(eraKey) ?? 0
  }

  async dial(callerId: string, roomDate: string, number: string): Promise<DialOutcome> {
    if (this.calls.has(callerId)) {
      throw new Error(`caller ${callerId} is already on a call`)
    }

    const dest = this.destinations.find(d => d.number === number)
    if (dest === undefined) return { outcome: "no-answer" }

    const era = eraFor(dest, roomDate)
    const eraKey = eraKeyFor(dest, roomDate)
    // Not alive in this year: the number simply rings, forever.
    if (era === null || eraKey === null) return { outcome: "no-answer" }

    if (this.occupancy(eraKey) >= era.lines) return { outcome: "busy" }

    const line = this.hosts.get(era.host)
    if (line === undefined) {
      return { outcome: "out-of-service", reason: `no host registered for "${era.host}"` }
    }

    // Seize the line before ringing, so a concurrent dial sees it taken.
    this.busyLines.set(eraKey, this.occupancy(eraKey) + 1)

    const abort = new AbortController()
    try {
      await line.ring(abort.signal)
    } catch {
      this.release(eraKey)
      return { outcome: "no-answer" }
    }

    const baud = era.speeds[0]
    if (baud === undefined) {
      this.release(eraKey)
      throw new Error(`destination ${dest.id} era has no line speed`)
    }

    this.calls.set(callerId, { eraKey, line, abort })
    return { outcome: "connected", eraKey, baud, line }
  }

  hangup(callerId: string): void {
    const call = this.calls.get(callerId)
    if (call === undefined) return
    this.calls.delete(callerId)
    call.abort.abort()
    call.line.hangup()
    this.release(call.eraKey)
  }

  private release(eraKey: string): void {
    const n = this.occupancy(eraKey)
    if (n <= 1) this.busyLines.delete(eraKey)
    else this.busyLines.set(eraKey, n - 1)
  }
}

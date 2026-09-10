/** A destination's presentation and capacity in one slice of time. Services
 *  changed across the era (spec 5.2), so this is versioned, not fixed. */
export interface DestinationEra {
  from: string            // ISO date, inclusive
  until: string           // ISO date, inclusive
  lines: number           // simultaneous callers the real service had (spec 5.6)
  speeds: number[]        // baud rates available in this era
  access: "direct-dial" | "telenet" | "tymnet"
  presentationName: string
  fidelity: "real-software" | "reconstruction"
  host: string            // host id the exchange resolves to a LineInterface
}

export interface Destination {
  id: string
  number: string
  name: string
  eras: DestinationEra[]
}

export interface PhoneBookEntry {
  name: string
  number: string
  fidelity: DestinationEra["fidelity"]
  speeds: number[]
}

export function eraFor(d: Destination, date: string): DestinationEra | null {
  return d.eras.find(e => e.from <= date && date <= e.until) ?? null
}

/** Occupancy is per destination-era, never global: a busy CBBS in 1980 does
 *  not block a caller in 1983, because those are different points on the
 *  timeline (spec 5.5). */
export function eraKeyFor(d: Destination, date: string): string | null {
  const i = d.eras.findIndex(e => e.from <= date && date <= e.until)
  return i === -1 ? null : `${d.id}@${i}`
}

export function phoneBook(ds: Destination[], date: string): PhoneBookEntry[] {
  const out: PhoneBookEntry[] = []
  for (const d of ds) {
    const era = eraFor(d, date)
    if (era === null) continue
    out.push({ name: d.name, number: d.number, fidelity: era.fidelity, speeds: [...era.speeds] })
  }
  return out
}

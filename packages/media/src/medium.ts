/** One physical thing a visitor can hold: a diskette, a cassette, a cartridge.
 *  Spec §6.1, verbatim. */
export interface Medium {
  id: string
  kind: "diskette-5.25" | "diskette-8" | "cassette" | "cartridge"
  format: "dsk" | "do" | "po" | "woz" | "nib" | "wav"
  label: string // what is written on it, in marker
  title?: string // catalogue information, for the honesty card
  publisher?: string
  released?: string // when the software came out
  acquired: string | "undated" // in-fiction date it entered this box
  writeProtected: boolean // the notch -- real state, not decoration
  provenance: "curated" | "uploaded" | "formatted" | "received"
  fidelity?: "real-software" | "reconstruction" // curated media only
}

export type MediumKind = Medium["kind"]

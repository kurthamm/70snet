export interface MachineSpec {
  id: string
  name: string
  emulator: "apple2ts"
  /** Museum card text shown beside the machine (spec 4.1, 6.4). */
  card: string
  modem: { id: string; name: string; dialing: "rotary" | "touch-tone" | "hayes-at"; speeds: number[] }
  drives: { slot: number; drive: number }[]
}

export interface Room {
  id: string
  name: string
  /** The room's in-fiction date. Governs what can be reached, never what the
   *  visitor owns (spec 2). */
  date: string
  machines: MachineSpec[]
}

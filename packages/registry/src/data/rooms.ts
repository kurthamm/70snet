import type { Room } from "../room"

export const ROOM_1980: Room = {
  id: "1980",
  name: "Fall 1980",
  date: "1980-10-01",
  machines: [
    {
      id: "apple2plus",
      name: "Apple II Plus",
      emulator: "apple2ts",
      card:
        "APPLE II PLUS, 1979. There is no software in the machine. " +
        "Software came on diskettes; try the box.",
      modem: {
        id: "micromodem2",
        name: "Micromodem II",
        dialing: "manual",
        speeds: [300],
      },
      drives: [
        { slot: 6, drive: 1 },
        { slot: 6, drive: 2 },
      ],
    },
  ],
}

/** Not shipped. A fixture proving the engine, per spec 13: the 1977 room's
 *  empty phone book must fall out of the lifespan rule, not a special case. */
export const ROOM_1977: Room = {
  id: "1977",
  name: "The Trinity Year",
  date: "1977-06-01",
  machines: [],
}

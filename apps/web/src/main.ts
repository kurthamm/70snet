/** Entry point: mount the room the visitor is in. For v1 that is always
 *  `ROOM_1980` -- picking a room from a URL, a room list, etc. is future
 *  work; this file just wires the one room this build ships (spec §3). */

import { ROOM_1980 } from "@70snet/registry/data/rooms"
import { DESTINATIONS } from "@70snet/registry/data/destinations"
import { renderRoom } from "./room"

const app = document.getElementById("app")
if (app === null) {
  throw new Error("index.html is missing #app; nothing to mount the room into")
}

app.appendChild(renderRoom(ROOM_1980, DESTINATIONS))

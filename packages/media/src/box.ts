import type { Medium } from "./medium"

/** A visitor's box of media. Private, and it accumulates across rooms
 *  (spec §6.2) -- it is nothing more than the media in it. */
export type Box = Medium[]

/** §5's destination-lifespan rule, pointed at a possession: a room shows
 *  only what the visitor owned by its date. `"undated"` -- an upload whose
 *  year the visitor did not supply -- is visible in every room. There is no
 *  third case and no default. */
export function visibleIn(box: Box, roomDate: string): Medium[] {
  return box.filter(m => m.acquired === "undated" || m.acquired <= roomDate)
}

export function addToBox(box: Box, medium: Medium): Box {
  return [...box, medium]
}

export function removeFromBox(box: Box, id: string): Box {
  return box.filter(m => m.id !== id)
}

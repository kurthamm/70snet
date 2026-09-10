/** The three outcomes of `navigator.storage.persist()`, kept distinct on
 *  purpose (spec §6.5): conflating "may be evicted" with "cannot be stored
 *  at all" is how a visitor loses an evening's work to something nobody
 *  told them about. */
export type Durability = "persistent" | "evictable" | "unavailable"

/** The slice of `StorageManager` this needs, injected so all three outcomes
 *  are testable in plain Node with no browser. */
export type DurabilityManager = Pick<StorageManager, "persist" | "estimate">

/** Ask the browser whether it will keep this visitor's box.
 *
 *  - `manager` absent (the API doesn't exist in this browser) -- storage
 *    still works, it is just `"evictable"`. This is NOT `"unavailable"`.
 *  - `persist()` resolves `true` -- `"persistent"`, exempt from eviction.
 *    Nothing to tell the visitor.
 *  - `persist()` resolves `false` -- `"evictable"`. Writes proceed; the
 *    disk box carries a line saying these disks are not guaranteed to
 *    survive. This is NOT storage being unavailable.
 *  - `persist()` throws -- IndexedDB itself is unavailable or blocked.
 *    `"unavailable"` drives the standing banner; there is no silent
 *    in-memory fallback. */
export async function describeDurability(
  manager: DurabilityManager | undefined,
): Promise<Durability> {
  if (manager === undefined) return "evictable"

  let persisted: boolean
  try {
    persisted = await manager.persist()
  } catch {
    return "unavailable"
  }

  return persisted ? "persistent" : "evictable"
}

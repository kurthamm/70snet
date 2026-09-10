import type { Medium } from "@70snet/media/medium"

/** What is in which drive of which machine. Machine state persists
 *  alongside the media, so a disk left in overnight is still there
 *  tomorrow (spec §6.3). */
export interface MachineDriveState {
  machineId: string
  slot: number
  drive: number
  mediumId: string | null
}

/** IndexedDB is unavailable, or threw where the spec requires it to work
 *  (open the database, run a transaction). Never a silent in-memory
 *  fallback -- a standing banner tells the visitor instead. */
export class StorageUnavailableError extends Error {
  constructor(detail: string) {
    super(`browser storage is unavailable: ${detail}`)
    this.name = "StorageUnavailableError"
  }
}

/** A disk image was requested that this box does not hold. */
export class MediumNotFoundError extends Error {
  constructor(id: string) {
    super(`no medium with id "${id}" is in this box`)
    this.name = "MediumNotFoundError"
  }
}

const DB_NAME = "70snet-diskbox"
const DB_VERSION = 1
const MEDIA_STORE = "media"
const IMAGES_STORE = "images"
const DRIVES_STORE = "drives"

/** The visitor's own browser: metadata and image bytes for every medium in
 *  their box, and which medium is in which drive. Nothing here reaches our
 *  server (spec §6.5). */
export interface BoxStore {
  list(): Promise<Medium[]>
  put(medium: Medium): Promise<void>
  remove(id: string): Promise<void>
  readImage(id: string): Promise<Uint8Array>
  writeImage(id: string, bytes: Uint8Array): Promise<void>
  readDriveState(): Promise<MachineDriveState[]>
  writeDriveState(state: MachineDriveState): Promise<void>
}

function wrapRequest<T>(request: IDBRequest<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(new StorageUnavailableError(`${what}: ${request.error?.message ?? "unknown error"}`))
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(new StorageUnavailableError(`could not open "${DB_NAME}": ${(err as Error).message}`))
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE)
      }
      if (!db.objectStoreNames.contains(DRIVES_STORE)) {
        db.createObjectStore(DRIVES_STORE, { keyPath: ["machineId", "slot", "drive"] })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(new StorageUnavailableError(`opening "${DB_NAME}": ${request.error?.message ?? "unknown error"}`))
    request.onblocked = () =>
      reject(new StorageUnavailableError(`opening "${DB_NAME}" is blocked by another open connection`))
  })
}

class IndexedDBBoxStore implements BoxStore {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<Medium[]> {
    const tx = this.db.transaction(MEDIA_STORE, "readonly")
    const store = tx.objectStore(MEDIA_STORE)
    return wrapRequest(store.getAll() as IDBRequest<Medium[]>, "listing media")
  }

  async put(medium: Medium): Promise<void> {
    const tx = this.db.transaction(MEDIA_STORE, "readwrite")
    const store = tx.objectStore(MEDIA_STORE)
    await wrapRequest(store.put(medium), `saving medium "${medium.id}"`)
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction([MEDIA_STORE, IMAGES_STORE], "readwrite")
    await wrapRequest(tx.objectStore(MEDIA_STORE).delete(id), `removing medium "${id}"`)
    await wrapRequest(tx.objectStore(IMAGES_STORE).delete(id), `removing image "${id}"`)
  }

  async readImage(id: string): Promise<Uint8Array> {
    const tx = this.db.transaction(IMAGES_STORE, "readonly")
    const store = tx.objectStore(IMAGES_STORE)
    const bytes = await wrapRequest(store.get(id) as IDBRequest<Uint8Array | undefined>, `reading image "${id}"`)
    if (bytes === undefined) throw new MediumNotFoundError(id)
    return bytes
  }

  async writeImage(id: string, bytes: Uint8Array): Promise<void> {
    const tx = this.db.transaction(IMAGES_STORE, "readwrite")
    const store = tx.objectStore(IMAGES_STORE)
    await wrapRequest(store.put(bytes, id), `writing image "${id}"`)
  }

  async readDriveState(): Promise<MachineDriveState[]> {
    const tx = this.db.transaction(DRIVES_STORE, "readonly")
    const store = tx.objectStore(DRIVES_STORE)
    return wrapRequest(store.getAll() as IDBRequest<MachineDriveState[]>, "reading drive state")
  }

  async writeDriveState(state: MachineDriveState): Promise<void> {
    const tx = this.db.transaction(DRIVES_STORE, "readwrite")
    const store = tx.objectStore(DRIVES_STORE)
    await wrapRequest(store.put(state), `writing drive state for "${state.machineId}"`)
  }
}

/** Open the visitor's box. `factory` defaults to the browser's own
 *  `indexedDB`, and is injectable so the store can be built and driven
 *  behind a fake in tests without a browser.
 *
 *  Throws `StorageUnavailableError` -- never falls back to memory -- when
 *  IndexedDB is missing, blocked, or throws. */
export async function openBox(factory?: IDBFactory): Promise<BoxStore> {
  const idb = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB)
  if (idb === undefined) {
    throw new StorageUnavailableError("no IndexedDB implementation is available in this browser")
  }
  const db = await openDatabase(idb)
  return new IndexedDBBoxStore(db)
}

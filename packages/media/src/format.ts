import type { MediumKind } from "./medium"

/** Thrown when an uploaded image cannot be identified as any recognised
 *  format for its kind. Names which check failed -- never a half-loaded
 *  disk (spec §6.6). */
export class UnidentifiableImageError extends Error {
  constructor(kind: MediumKind, detail: string) {
    super(`could not identify image for kind "${kind}": ${detail}`)
    this.name = "UnidentifiableImageError"
  }
}

const APPLE_525_DISK_BYTES = 143360

// "WOZ1" / "WOZ2" magic, followed by the FF 0A 0D 0A trailer that catches
// line-ending corruption from an old-style text-mode transfer.
const WOZ1_MAGIC = [0x57, 0x4f, 0x5a, 0x31]
const WOZ2_MAGIC = [0x57, 0x4f, 0x5a, 0x32]
const WOZ_TRAILER = [0xff, 0x0a, 0x0d, 0x0a]

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false
  }
  return true
}

function looksLikeWoz(bytes: Uint8Array): boolean {
  return startsWith(bytes, WOZ1_MAGIC) || startsWith(bytes, WOZ2_MAGIC)
}

function validateWoz(bytes: Uint8Array, kind: MediumKind): void {
  const trailer = bytes.subarray(4, 8)
  if (!startsWith(trailer, WOZ_TRAILER)) {
    throw new UnidentifiableImageError(
      kind,
      "WOZ1/WOZ2 magic present but the FF 0A 0D 0A trailer is corrupted",
    )
  }
}

function validateDiskette525(bytes: Uint8Array, kind: MediumKind): void {
  if (looksLikeWoz(bytes)) {
    validateWoz(bytes, kind)
    return
  }
  if (bytes.length !== APPLE_525_DISK_BYTES) {
    throw new UnidentifiableImageError(
      kind,
      `not exactly ${APPLE_525_DISK_BYTES.toLocaleString("en-US")} bytes ` +
        `(a 5.25" Apple disk) and no WOZ1/WOZ2 header (got ${bytes.length} bytes)`,
    )
  }
}

/** Validate an uploaded image by the medium's `kind`. Anything unidentifiable
 *  throws a named error saying which check failed -- we never accept a
 *  half-loaded disk (spec §6.6). */
export function validateImage(bytes: Uint8Array, kind: MediumKind): void {
  switch (kind) {
    case "diskette-5.25":
      validateDiskette525(bytes, kind)
      return
    default:
      throw new UnidentifiableImageError(kind, `no validator is defined for kind "${kind}"`)
  }
}

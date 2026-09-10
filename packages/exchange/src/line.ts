/** What the exchange requires of anything reachable by telephone — a CP/M
 *  machine, or in Plan B another visitor's Apple. The exchange never learns
 *  which; bytes are opaque octets. */
export interface LineInterface {
  /** Seize and ring. Resolves when the far end answers with carrier.
   *  Rejects if it never answers. */
  ring(signal: AbortSignal): Promise<void>
  /** Caller -> destination. */
  send(bytes: Uint8Array): void
  /** Destination -> caller. */
  onData(cb: (bytes: Uint8Array) => void): void
  /** Release the line. Must be safe to call twice. */
  hangup(): void
  /** The destination died mid-call, or could not be reached at all. */
  onFailure(cb: (err: Error) => void): void
}

export interface HostRegistry {
  get(hostId: string): LineInterface | undefined
}

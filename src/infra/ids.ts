import { randomBytes } from 'node:crypto'

/**
 * RFC 9562 UUIDv7: a 48-bit millisecond timestamp followed by random bits, so IDs sort
 * chronologically by generation time — useful for anything indexed/browsed by insertion order
 * (users, sessions, match_adjustments). Node has no built-in v7 generator (crypto.randomUUID is
 * v4 only), and this is small enough not to warrant a dependency.
 */
export function uuidv7(timestampMs: number = Date.now()): string {
  const ts = Math.floor(timestampMs)
  const bytes = new Uint8Array(16)

  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff
  bytes[5] = ts & 0xff

  bytes.set(randomBytes(10), 6)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70 // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // variant 10

  const hex = Buffer.from(bytes).toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

/**
 * Injected into every use-case that needs a server-generated ID, so tests can supply a
 * deterministic sequence instead of real random UUIDs. Match `id` is the one ID that's never
 * generated this way — it's client-supplied, on purpose (see docs/API.md#idempotency).
 */
export interface Ids {
  newId(): string
}

export const systemIds: Ids = { newId: () => uuidv7() }

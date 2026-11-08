/**
 * The ONE content hash of the local-first package: FNV-1a over `JSON.stringify(payload)`.
 *
 * Byte-identical to the server's `hashSyncPayload` (`api/src/domain/sync/syncProtocol.ts`), so
 * the server can VERIFY the `payloadHash` a batch carries. The store stamps it on a journal
 * frame, the unbound marker keeps it, and `ingestServerRecords` compares payloads by it.
 * `fnv1a32` is the same loop with a caller's seed, for a stable id.
 */

export function fnv1a32(text: string, seed = 2166136261): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashPayload(payload: unknown): string {
  const text = JSON.stringify(payload) ?? 'null';
  return `fnv1a:${fnv1a32(text).toString(16).padStart(8, '0')}`;
}

/** The value with object keys sorted at every depth (arrays keep their order). */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortedKeys(record[key])]));
}

/**
 * `hashPayload` of the key-sorted form, for comparing two payloads that mean the same thing
 * whatever their key order. NOT the wire hash: `hashPayload` stays the one the server verifies.
 */
export function canonicalPayloadHash(payload: unknown): string {
  return hashPayload(sortedKeys(payload));
}

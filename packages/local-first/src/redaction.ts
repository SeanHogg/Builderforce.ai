/**
 * The ONE upload/log redaction rule for local-first snapshots.
 *
 * Pure: no IndexedDB, no filesystem, no DOM — so a non-browser consumer (the
 * api, the VSIX host) can import it from the package entry without type-checking
 * the IndexedDB adapter. `indexedDb.ts` and `durabilityContract.ts` both use this.
 */

/**
 * Keys stripped before a snapshot may be uploaded or logged. A key matches on
 * its lowercase form, so `apiKey`, `APIKEY`, and `apikey` are all secrets.
 */
export const INDEXEDDB_REDACTED_KEYS = [
  'token',
  'password',
  'authorization',
  'cookie',
  'apikey',
  'clientsecret',
] as const;

/** The rule in words, for review and for host-facing documentation. */
export const INDEXEDDB_REDACTION_RULE =
  'Only exportForUploadOrLog() output may be uploaded or logged. It strips every '
  + 'secret-shaped key at every depth — a key whose lowercase name is one of '
  + `${INDEXEDDB_REDACTED_KEYS.join(', ')} or contains token, secret, password, `
  + 'authorization, cookie, or apikey — so accessToken, client_secret and '
  + 'sessionCookie are stripped too. The strip is recursive through arrays and '
  + 'nested objects, the input is not mutated, and a dropped key is absent rather '
  + 'than blanked. export() is the unfiltered local record and must not leave the device.';

const REDACT_PATTERN = /token|secret|password|authorization|cookie|apikey/i;

/** True when `key` is secret-shaped under the rule above, ignoring case. */
export function isSecretShapedKey(key: string): boolean {
  return typeof key === 'string' && REDACT_PATTERN.test(key);
}

/**
 * Strip secret-shaped keys at every depth. The input is not mutated; the result
 * is the only value eligible to be uploaded or logged.
 */
export function redactSnapshotForUploadOrLog<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretShapedKey(key)) continue;
    out[key] = redactValue(child);
  }
  return out;
}

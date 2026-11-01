/**
 * The ONE structured-clone helper for the local-first store.
 *
 * `store.ts` (the read/scan helpers and the snapshot export) and
 * `storeTransaction.ts` (the copy-on-write draft) both clone what they hand
 * across the committed/overlay boundary so a caller can never mutate state it
 * does not own. One definition, imported by both — keep them identical.
 */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

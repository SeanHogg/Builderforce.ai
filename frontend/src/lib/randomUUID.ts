/**
 * `crypto.randomUUID()` for every browser the app supports.
 *
 * Safari only has `randomUUID` from 15.4, and every browser withholds it outside a
 * secure context (a LAN IP over http), while `crypto.getRandomValues` exists in both.
 * The app calls `crypto.randomUUID()` directly in well over a hundred places (and the
 * shared canvas contract does too), so rather than route each call through a helper,
 * {@link installRandomUUID} fills the one missing method once, before any app code
 * runs (`src/instrumentation-client.ts`).
 */

/** An RFC 4122 version-4 UUID from `getRandomValues`. */
export function uuidV4(bytesSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): `${string}-${string}-${string}-${string}-${string}` {
  const b = bytesSource.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Give `crypto` a `randomUUID` where the browser left it out. No-op where it exists. */
export function installRandomUUID(target: Crypto | undefined = globalThis.crypto): void {
  if (!target || typeof target.getRandomValues !== 'function' || typeof target.randomUUID === 'function') return;
  Object.defineProperty(target, 'randomUUID', {
    value: () => uuidV4(target),
    configurable: true,
    writable: true,
  });
}

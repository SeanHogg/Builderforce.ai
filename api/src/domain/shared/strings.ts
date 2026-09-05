/**
 * Shared string utilities (deterministic hashing).
 *
 * Slugging lives in `@builderforce/creation-canvas-contract` (`slugify`), the
 * one implementation the api, the web app and the VS Code client all compile
 * against — see that file's header for why the copy that used to sit here was
 * retired.
 */

/**
 * FNV-1a 32-bit hash → unsigned 32-bit integer. Deterministic, no crypto/IO.
 * `seed` defaults to the FNV offset basis (0x811c9dc5). Compose to hex with
 * `.toString(16).padStart(8, '0')`.
 */
export function fnv1a32(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

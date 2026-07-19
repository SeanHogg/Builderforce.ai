/** Shared string utilities (slugging, deterministic hashing). */

export interface SlugifyOptions {
  /** Max slug length (characters). Default 60. */
  maxLen?: number;
  /** Value returned when slugging yields an empty string. Default '' (allowed). */
  fallback?: string;
}

/**
 * Lowercase → hyphenate → trim to a URL/id-safe slug. Collapses every run of
 * non `[a-z0-9]` characters to a single '-', strips leading/trailing '-', then
 * caps at `maxLen`. Returns `fallback` when the result is empty.
 *
 * (Leading/trailing whitespace is folded to '-' and then stripped, so an
 * explicit `.trim()` is redundant — this matches every former per-module copy.)
 */
export function slugify(input: string, opts?: SlugifyOptions): string {
  const s = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, opts?.maxLen ?? 60);
  return s || (opts?.fallback ?? '');
}

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

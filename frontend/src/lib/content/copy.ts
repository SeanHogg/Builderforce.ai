/**
 * THE seam between marketing STRUCTURE (these `content/*` modules) and marketing
 * COPY (the five message catalogs).
 *
 * Structure — ids, hrefs, icons, ordering — stays in TypeScript, because it is
 * what code branches on and what tests pin. Every sentence a visitor or a
 * crawler reads is a catalog message, so a locale translates the page rather
 * than inheriting an English one. The two meet here: a reader is anything that
 * can resolve a dotted key, which is exactly what a ROOT-scoped next-intl
 * translator is — `useTranslations()` in a Client Component, `await
 * getTranslations()` on the server. Builders that need copy (JSON-LD, the auth
 * panels) take one as their first argument instead of importing English.
 */
export interface CopyReader {
  (key: string, values?: Record<string, string | number>): string;
  raw(key: string): unknown;
}

/** The catalog namespace every `content/*` module files its copy under. */
export const CONTENT_NS = 'marketing.content';

/** Absolute catalog key for a path under {@link CONTENT_NS}. */
export function contentKey(path: string): string {
  return `${CONTENT_NS}.${path}`;
}

/** A catalog array read raw, or `[]` when the key is absent or not a list. */
export function rawList<T>(t: CopyReader, key: string): T[] {
  const value = t.raw(key);
  return Array.isArray(value) ? (value as T[]) : [];
}

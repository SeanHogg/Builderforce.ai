/**
 * Defensive JSON coercion for columns that may arrive already-decoded (a JSONB
 * driver decode), as a JSON string (legacy text columns), or null. One place for
 * the "parse-or-fall-back-to-[]/{}" pattern that was copied across route/service
 * files.
 */

/**
 * Coerce `raw` to an array. Already an array → returned as-is; a JSON string that
 * parses to an array → the parsed array; anything else (non-array JSON, invalid
 * JSON, null/undefined) → `[]`.
 */
export function parseJsonArray<T = unknown>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Coerce `raw` to a plain object. Already a non-array object → returned as-is; a
 * JSON string that parses to a non-array object → the parsed object; anything else
 * (array, scalar, invalid JSON, null/undefined) → `{}`.
 */
export function parseJsonObject<T = Record<string, unknown>>(raw: unknown): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as T;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as T)
        : ({} as T);
    } catch {
      return {} as T;
    }
  }
  return {} as T;
}

/**
 * `JSON.parse`, or `fallback` — for an absent OR an unparseable string. The
 * `safeJson` that five modules had written, differing only in what they fell
 * back to (`null`, `[]`, the raw text, a caller value): the fallback is now the
 * caller's to state, once, at the call.
 */
export function parseJsonOr<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

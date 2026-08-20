/**
 * Reading a JSON/JSONB column, whichever shape the driver hands back.
 *
 * A `jsonb` column comes back from the driver ALREADY PARSED — an array or an
 * object, never a string. Four call sites had each written their own reader on
 * the assumption it was a string, and three of them were silently wrong:
 *
 *   - `deserializeOrigins` JSON.parse'd `tenant_api_keys.allowed_origins`, so
 *     `JSON.parse(['https://a'])` stringified the array to `https://a`, threw,
 *     and returned null — which `originAllowed` reads as "no origin allowed",
 *     rejecting every browser request the key was minted to permit;
 *   - the impersonation-session reader JSON.parse'd `pages_visited` the same
 *     way, so the audit trail rendered an empty page list for every session;
 *   - `coercePermissions` existed TWICE (application/rbac + presentation/admin)
 *     with identical bodies — the duplication this module exists to remove.
 *
 * One reader, tolerant of both shapes, so a column that is `jsonb` today and a
 * row that was written as a string before the type was corrected both resolve.
 * The Drizzle declarations were corrected to `jsonb()` in the same pass (see
 * api/scripts/check-migrations.mjs, FIFTH GUARD, which now fails the build on
 * this class of drift) — these helpers keep legacy string rows readable.
 */

/** Parse a value that may already BE the parsed JSON. Returns undefined when it
 *  is neither valid JSON nor a parsed value. */
function parseJsonColumn(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** A JSON/JSONB array column read as-is. The caller names the element type; no
 *  member validation happens here, because the shapes that use this (an audit
 *  trail of `{ path, ts }` page visits) are written only by us. Returns `[]` for
 *  null/unparseable/non-array. */
export function coerceJsonArray<T = unknown>(value: unknown): T[] {
  const parsed = parseJsonColumn(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** A JSON/JSONB array column read as `string[]`. Non-string members are dropped
 *  rather than coerced — a permission or an origin that is not a string is not a
 *  permission or an origin. Returns `[]` for null/unparseable/non-array. */
export function coerceStringArray(value: unknown): string[] {
  const parsed = parseJsonColumn(value);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
}

/** As `coerceStringArray`, but preserves the "column is unset" case: null in,
 *  null out. Used where an absent allowlist means something different from an
 *  empty one (`tenant_api_keys.allowed_origins`: NULL = server-only key). */
export function coerceStringArrayOrNull(value: unknown): string[] | null {
  if (value == null) return null;
  const parsed = parseJsonColumn(value);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
}

/** A JSON/JSONB object column read as a plain record. Returns `{}` for
 *  null/unparseable/non-object (an array is not a record). */
export function coerceJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseJsonColumn(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

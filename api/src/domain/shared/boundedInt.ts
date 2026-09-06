/**
 * Bounded integers from untrusted input — the ONE reading of `?limit=`,
 * `?offset=`, `?days=` and every other "a number, please, within this band".
 *
 * Before this module the same clamp was written 55 times across the route
 * layer and twice more in application code, and twenty of those copies were
 * NaN-unsafe: `Math.min(Number(q ?? 50), 200)` sends `NaN` to Postgres when
 * `?limit=abc` arrives, several accepted a negative offset, and `?limit=` (empty)
 * became a limit of zero. Twelve route files also carried a byte-identical
 * `parseDays`. Pure and dependency-free so both presentation and application
 * code can read a bound from here without one importing the other.
 *
 * Rule: a value that does not parse is the DEFAULT; a value that parses is
 * floored and clamped into `[min, max]`. Junk never reaches the database.
 */

export interface BoundedIntOptions {
  /** Used when the raw value is absent or does not parse as a finite number. */
  def: number;
  /** Inclusive floor. Default 0. */
  min?: number;
  /** Inclusive ceiling. Default: no ceiling. */
  max?: number;
}

export function boundedIntParam(raw: unknown, { def, min = 0, max = Number.MAX_SAFE_INTEGER }: BoundedIntOptions): number {
  const n = typeof raw === 'number' ? raw : raw == null || raw === '' ? NaN : Number(raw);
  const base = Number.isFinite(n) ? Math.floor(n) : def;
  return Math.min(max, Math.max(min, base));
}

/** A page size: at least 1, at most `max`, `def` when absent or junk. */
export function limitParam(raw: unknown, def: number, max: number): number {
  return boundedIntParam(raw, { def, min: 1, max });
}

/** A row offset: never negative, 0 when absent or junk. */
export function offsetParam(raw: unknown): number {
  return boundedIntParam(raw, { def: 0, min: 0 });
}

/** A `?days=` window: `def` when absent or junk, clamped to `[min, max]`. */
export function daysParam(raw: unknown, def = 30, max = 365, min = 1): number {
  return boundedIntParam(raw, { def, min, max });
}

/**
 * The hard ceiling on a list endpoint that has no pagination of its own. A
 * list a person reads without paging is never a thousand rows; a list an
 * aggregation reads is not served through such an endpoint. Sixty-three GET
 * handlers ordered a table and returned every row — this is what stops one
 * of them from returning the table.
 */
export const LIST_ROW_CAP = 1000;

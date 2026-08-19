/**
 * Query/route parameter parsing shared by every route module.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `Number.isInteger(n) && n > 0` was written out TEN times across the route
 * layer, under six different names (`parseId`, `parseIntId`, `parseIntParam`,
 * `parseProjectId`, `parseProjectIdParam`, and a closure inside `llmRoutes`),
 * splitting on nothing but whether the author preferred `undefined` or `null`
 * for "absent". Ten identical predicates is not ten decisions — it is one
 * decision copied, and it drifts the first time someone decides `0` should be
 * accepted, or that `"12abc"` should be, in one copy and not the other nine.
 *
 * `undefined` is the canonical absent value: it is what an optional TypeScript
 * parameter already means, so `computeX(db, tenantId, days, positiveIntParam(q))`
 * type-checks with no adapter. {@link positiveIntOrNull} exists only for the
 * callers whose surrounding code models "no value" as `null` (a JSON response
 * field, a nullable column) — same predicate, one conversion, stated once.
 */

/**
 * An optional positive-integer parameter (a project id, a team id, a row id).
 *
 * Strict on purpose. `Number('')` is 0 and `Number(undefined)` is NaN, both of
 * which fail `isInteger && > 0`, so a missing parameter and a junk one produce
 * the same `undefined` — and an id of `0`, which no serial column ever issues,
 * is rejected rather than quietly filtering on a row that cannot exist.
 */
export function positiveIntParam(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** {@link positiveIntParam} for callers that model absence as `null`. */
export function positiveIntOrNull(raw: unknown): number | null {
  return positiveIntParam(raw) ?? null;
}

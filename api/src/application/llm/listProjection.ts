/**
 * List projections — keep the Brain's context window bounded.
 *
 * The Brain re-sends its whole transcript to the model every turn, so an unbounded
 * `*.list` result (e.g. `tasks.list` returning 352 full rows, every column, tens of KB)
 * accumulates across tool calls and eventually exhausts the model's context window.
 * List tools therefore return a COMPACT projection + a `total`/`truncated` envelope so
 * the model knows to narrow its query; full per-record detail stays available via the
 * matching `*.get` tool.
 *
 * Shared by `builtinMcpService` and the catalog modules split out of it, so a page size
 * or a snippet length means the same thing in every list tool.
 */

/** Default page size for a list tool, and the hard ceiling a caller can request. */
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;

/**
 * THE count clamp: a caller-supplied count into `[1, max]` as a whole number. Absent,
 * non-numeric or non-finite input takes `fallback`; fractions are floored. Every limit
 * that reaches SQL goes through here — a NaN or `2.5` LIMIT is a Postgres error.
 */
export function clampCount(v: unknown, fallback: number, max: number): number {
  const n = v != null && v !== '' ? Number(v) : fallback;
  return Math.max(1, Math.min(Number.isFinite(n) ? Math.floor(n) : fallback, max));
}

/** Clamp a caller-supplied `limit` into `[1, LIST_MAX_LIMIT]`, defaulting when absent. */
export const clampLimit = (v: unknown): number => clampCount(v, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);

/** A bounded, single-line description hint — never the full (often huge) blob. */
export const snippet = (d: unknown, n = 160): string | undefined => {
  if (typeof d !== 'string' || !d) return undefined;
  const one = d.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

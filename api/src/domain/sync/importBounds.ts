/**
 * Domain — bounded sync import page size (G17).
 *
 * The client coordinator already caps a pull at 500 records
 * (`packages/local-first` `maxPullRecords`). The server must apply the same
 * ceiling itself: a caller that omits the limit, or asks for an unlimited
 * page, must not be able to stall the host with an unbounded import.
 *
 * Pure: no database, no HTTP. A future pull route calls this before it reads.
 */

/** Default and fallback page cap. Matches the client coordinator default. */
export const DEFAULT_IMPORT_PAGE_MAX = 500;

function finitePositiveCap(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * Clamp a requested import page to a finite positive bound.
 *
 * `requested` that is missing, non-finite (including `Infinity`), or not
 * positive becomes `hardMax`. A request above `hardMax` becomes `hardMax`.
 * A positive finite request at or under `hardMax` is returned unchanged.
 * `hardMax` itself must be a positive finite number; otherwise the default
 * cap is used. The result is never `Infinity`.
 */
export function boundImportPage(
  requested?: number,
  hardMax: number = DEFAULT_IMPORT_PAGE_MAX,
): number {
  const cap = finitePositiveCap(hardMax, DEFAULT_IMPORT_PAGE_MAX);
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return cap;
  return requested > cap ? cap : requested;
}

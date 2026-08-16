/**
 * Canonical, order-independent JSON stringification — key-sorted at every level
 * so two logically-identical objects with fields authored in a different order
 * produce the same string. Used anywhere a stable hash or a stable comparison
 * has to be taken over a JSON-shaped value.
 *
 * Lifted out of `application/boardsync/reconciler.ts` (`hashFields`'s private
 * helper) the first time a SECOND caller needed the identical rule — one
 * definition of "canonical form" rather than two that could drift.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${k}:${stableStringify(obj[k])}`).join(',')}}`;
}

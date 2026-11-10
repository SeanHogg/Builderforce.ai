/**
 * Split a list into consecutive slices of at most `size` — THE helper for keeping an
 * id list bound into one statement (`IN (...)`, a multi-row `VALUES`) from growing
 * unbounded. Pure.
 */
export function chunked<T>(list: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('chunked: size must be a positive integer');
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

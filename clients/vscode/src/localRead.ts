/**
 * Local-first read (G03).
 *
 * A local store that exists is the read. A JSON snapshot is used only when
 * that store is absent (null or undefined). An empty object is a local value
 * and wins. This does not fetch, and it does not merge the two values.
 */

function isPresentLocal<T extends object>(value: T | null | undefined): value is T {
  return value != null && typeof value === "object";
}

/**
 * Return `local` when it is a non-null object, including `{}`.
 * Return `snapshot` only when `local` is null or undefined.
 */
export function readLocalFirst<T extends object, S>(
  local: T | null | undefined,
  snapshot: S,
): T | S {
  if (isPresentLocal(local)) return local;
  return snapshot;
}

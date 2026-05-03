import type { Shape } from "./shape";

/**
 * Iterate every multi-index in row-major (C) order for a given shape.
 * Reuses a single index array across iterations — callers that need to keep
 * an index must clone it.
 */
export function* iterIndices(shape: Shape): Generator<number[]> {
  const n = shape.length;
  const idx = new Array<number>(n).fill(0);
  if (n === 0 || shape.some((d) => d === 0)) return;
  while (true) {
    yield idx;
    let i = n - 1;
    while (i >= 0) {
      const next = idx[i]! + 1;
      if (next < shape[i]!) {
        idx[i] = next;
        break;
      }
      idx[i] = 0;
      i--;
    }
    if (i < 0) return;
  }
}

export function offsetOf(idx: ReadonlyArray<number>, strides: ReadonlyArray<number>, base: number): number {
  let off = base;
  for (let i = 0; i < idx.length; i++) off += idx[i]! * strides[i]!;
  return off;
}

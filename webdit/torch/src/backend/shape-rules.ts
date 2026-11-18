import { normalizeAxes, productOf, type Shape } from "../shape";
import { UnsupportedOpError } from "./backend";

/**
 * Shape arithmetic every backend agrees on. Both backends call these, so a
 * shape the CPU reference accepts is exactly a shape the WebGPU backend accepts.
 */

export interface MatmulShape {
  batch: number[];
  /** Batch elements each operand contributes (0 = broadcast 2D operand). */
  aBatched: boolean;
  bBatched: boolean;
  M: number;
  K: number;
  N: number;
  outShape: number[];
}

export function matmulShape(a: Shape, b: Shape, transA: boolean, transB: boolean): MatmulShape {
  if (a.length < 2 || b.length < 2) {
    throw new UnsupportedOpError("matmul", `both operands must be at least 2D, got ${a.length}D and ${b.length}D`);
  }
  const aRows = a[a.length - 2]!;
  const aCols = a[a.length - 1]!;
  const bRows = b[b.length - 2]!;
  const bCols = b[b.length - 1]!;
  const M = transA ? aCols : aRows;
  const K = transA ? aRows : aCols;
  const K2 = transB ? bCols : bRows;
  const N = transB ? bRows : bCols;
  if (K !== K2) throw new Error(`matmul: inner dim mismatch (${K} vs ${K2})`);
  const aBatch = a.slice(0, -2);
  const bBatch = b.slice(0, -2);
  let batch: number[];
  if (aBatch.length === 0) batch = [...bBatch];
  else if (bBatch.length === 0) batch = [...aBatch];
  else if (aBatch.length === bBatch.length && aBatch.every((d, i) => d === bBatch[i])) batch = [...aBatch];
  else {
    throw new UnsupportedOpError(
      "matmul",
      `batch dims ${JSON.stringify(aBatch)} vs ${JSON.stringify(bBatch)} must be equal or one operand 2D`,
    );
  }
  return {
    batch,
    aBatched: aBatch.length > 0,
    bBatched: bBatch.length > 0,
    M,
    K,
    N,
    outShape: [...batch, M, N],
  };
}

export interface ReducePlan {
  /** Sorted, normalized axes being reduced. */
  axes: number[];
  outShape: number[];
  keepShape: number[];
}

export function reducePlan(shape: Shape, axes: ReadonlyArray<number>, keepDims: boolean): ReducePlan {
  const norm = [...new Set(normalizeAxes(axes, shape.length))].sort((x, y) => x - y);
  const outShape: number[] = [];
  const keepShape: number[] = [];
  for (let i = 0; i < shape.length; i++) {
    if (norm.includes(i)) {
      keepShape.push(1);
      if (keepDims) outShape.push(1);
    } else {
      outShape.push(shape[i]!);
      keepShape.push(shape[i]!);
    }
  }
  return { axes: norm, outShape, keepShape };
}

/** Rows × last-dim split used by every row-wise kernel (softmax, layernorm, cross-entropy). */
export function rowsOf(shape: Shape, op: string): { rows: number; cols: number } {
  if (shape.length === 0) throw new UnsupportedOpError(op, "needs at least a 1D input");
  const cols = shape[shape.length - 1]!;
  return { rows: productOf(shape.slice(0, -1)), cols };
}

export function sameShape(a: Shape, b: Shape, op: string): void {
  if (a.length !== b.length || a.some((d, i) => d !== b[i])) {
    throw new Error(`${op}: shapes ${JSON.stringify(a)} and ${JSON.stringify(b)} must match`);
  }
}

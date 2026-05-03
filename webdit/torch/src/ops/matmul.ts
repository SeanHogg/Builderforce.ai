import { iterIndices, offsetOf } from "../iter";
import { broadcastShape, broadcastStrides, contiguousStrides, productOf } from "../shape";
import { Tensor } from "../tensor";

/**
 * Matrix multiply with PyTorch semantics:
 *   - leading batch dims are broadcast (a [B1, ..., M, K] @ b [B2, ..., K, N] → [..., M, N])
 *   - innermost two dims are the matrix dims
 *   - all dtype must be float32 (V0 limitation)
 */
export function matmul(a: Tensor, b: Tensor): Tensor {
  if (a.dtype !== "float32" || b.dtype !== "float32") {
    throw new Error(`matmul: float32 only (got ${a.dtype} and ${b.dtype})`);
  }
  if (a.ndim < 2 || b.ndim < 2) {
    throw new Error(`matmul: both inputs must be at least 2D, got ${a.ndim}D and ${b.ndim}D`);
  }
  const M = a.shape[a.ndim - 2]!;
  const K = a.shape[a.ndim - 1]!;
  const K2 = b.shape[b.ndim - 2]!;
  const N = b.shape[b.ndim - 1]!;
  if (K !== K2) {
    throw new Error(`matmul: inner dim mismatch (a has K=${K}, b has K=${K2})`);
  }
  const aBatch = a.shape.slice(0, -2);
  const bBatch = b.shape.slice(0, -2);
  const batch = broadcastShape(aBatch, bBatch);
  const outShape = [...batch, M, N];
  const outData = new Float32Array(productOf(outShape));

  const aBatchStrides = broadcastStrides(aBatch, batch, a.strides.slice(0, -2));
  const bBatchStrides = broadcastStrides(bBatch, batch, b.strides.slice(0, -2));
  const oBatchStrides = contiguousStrides(batch);

  const aMStride = a.strides[a.ndim - 2]!;
  const aKStride = a.strides[a.ndim - 1]!;
  const bKStride = b.strides[b.ndim - 2]!;
  const bNStride = b.strides[b.ndim - 1]!;

  const aData = a.data as Float32Array;
  const bData = b.data as Float32Array;

  if (batch.length === 0) {
    matmul2d(outData, 0, aData, a.offset, aMStride, aKStride, bData, b.offset, bKStride, bNStride, M, N, K);
    return Tensor.contiguous(outData, outShape, "float32");
  }
  for (const idx of iterIndices(batch)) {
    const aOff = offsetOf(idx, aBatchStrides, a.offset);
    const bOff = offsetOf(idx, bBatchStrides, b.offset);
    const oOff = offsetOf(idx, oBatchStrides, 0) * M * N;
    matmul2d(outData, oOff, aData, aOff, aMStride, aKStride, bData, bOff, bKStride, bNStride, M, N, K);
  }
  return Tensor.contiguous(outData, outShape, "float32");
}

function matmul2d(
  out: Float32Array,
  outOff: number,
  a: Float32Array,
  aOff: number,
  aMStride: number,
  aKStride: number,
  b: Float32Array,
  bOff: number,
  bKStride: number,
  bNStride: number,
  M: number,
  N: number,
  K: number,
): void {
  for (let m = 0; m < M; m++) {
    const aRow = aOff + m * aMStride;
    const oRow = outOff + m * N;
    for (let n = 0; n < N; n++) {
      let acc = 0;
      const bCol = bOff + n * bNStride;
      for (let k = 0; k < K; k++) {
        acc += a[aRow + k * aKStride]! * b[bCol + k * bKStride]!;
      }
      out[oRow + n] = acc;
    }
  }
}

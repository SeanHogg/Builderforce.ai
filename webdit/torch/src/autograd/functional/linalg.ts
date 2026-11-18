import type { BackendTensor } from "../../backend/backend";
import type { DeviceTensor } from "../device-tensor";
import { add } from "./arith";
import { backendOf, record, sumTo } from "../record";

/**
 * Matmul with its grad rule. Transposition rides on the backend's flags, so
 * neither the forward of `x @ Wᵀ` nor any gradient materializes a transpose.
 *
 * With A' = op(A), B' = op(B), C = A'B':
 *   dA' = gy B'ᵀ        dB' = A'ᵀ gy
 * and dA / dB are those, transposed back when the operand was transposed.
 */
export function matmulT(a: DeviceTensor, b: DeviceTensor, transA: boolean, transB: boolean): DeviceTensor {
  const be = backendOf("matmul", a, b);
  const out = be.matmul(a.handle, b.handle, transA, transB);
  return record("matmul", out, [a, b], (gy, needs) => {
    let ga: BackendTensor | null = null;
    let gb: BackendTensor | null = null;
    if (needs[0]) {
      const raw = transA ? be.matmul(b.handle, gy, transB, true) : be.matmul(gy, b.handle, false, !transB);
      ga = sumTo(be, raw, a.shape);
      be.release(raw);
    }
    if (needs[1]) {
      const raw = transB ? be.matmul(gy, a.handle, true, transA) : be.matmul(a.handle, gy, !transA, false);
      gb = sumTo(be, raw, b.shape);
      be.release(raw);
    }
    return [ga, gb];
  });
}

export const matmul = (a: DeviceTensor, b: DeviceTensor) => matmulT(a, b, false, false);

/** y = x @ weightᵀ + bias — weight is [out, in], PyTorch's layout. */
export function linear(x: DeviceTensor, weight: DeviceTensor, bias: DeviceTensor | null = null): DeviceTensor {
  const y = matmulT(x, weight, false, true);
  return bias ? add(y, bias) : y;
}

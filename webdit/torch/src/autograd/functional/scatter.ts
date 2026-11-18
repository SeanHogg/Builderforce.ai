import type { DeviceTensor } from "../device-tensor";
import { checkIndexRange, hostIndicesOf } from "../index-check";
import { backendOf, record } from "../record";

/**
 * Row scatter-add — PyTorch's `zeros(numRows, …).index_add_(0, ids, src)`:
 * out[ids[i]] += src[i], with every other row zero. ids is an int32 tensor of
 * any shape; src is [...ids.shape, dim]; the result is [numRows, dim].
 *
 * It is `embedding`'s transpose, so it runs on the same backend pair: forward
 * is the embedding gradient kernel (deterministic CSR on WebGPU when the ids
 * are host-known), and its gradient is the embedding gather `gy[ids]`. Together
 * with `embedding` (gather) it routes a subset of rows through a computation
 * and back — e.g. a mixture-of-experts layer evaluating each expert only on
 * the positions routed to it.
 */
export function indexAdd(ids: DeviceTensor, src: DeviceTensor, numRows: number): DeviceTensor {
  const be = backendOf("index_add", ids, src);
  if (ids.dtype !== "int32") throw new Error(`index_add: ids must be int32, got ${ids.dtype}`);
  if (!Number.isInteger(numRows) || numRows < 1) throw new Error(`index_add: numRows must be a positive integer, got ${numRows}`);
  const lead = ids.shape.length;
  if (src.ndim !== lead + 1 || ids.shape.some((d, i) => src.shape[i] !== d)) {
    throw new Error(`index_add: src [${src.shape.join(", ")}] must be [...ids.shape (${ids.shape.join(", ")}), dim]`);
  }
  checkIndexRange("index_add", ids, numRows);
  const out = be.embeddingBackward(ids.handle, src.handle, numRows, hostIndicesOf(ids));
  return record("index_add", out, [ids, src], (gy) => [null, be.embedding(gy, ids.handle)], [], [0]);
}

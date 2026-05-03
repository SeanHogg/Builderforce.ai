import { iterIndices, offsetOf } from "../iter";
import { contiguousStrides } from "../shape";
import { Tensor } from "../tensor";

/**
 * Token-id → embedding lookup. Equivalent to `weight[ids]`.
 *
 *   weight: [num_embeddings, embedding_dim]
 *   ids   : [...]  (int64 or int32)
 *   out   : [..., embedding_dim]
 */
export class Embedding {
  readonly numEmbeddings: number;
  readonly embeddingDim: number;

  constructor(readonly weight: Tensor) {
    if (weight.ndim !== 2) {
      throw new Error(`Embedding: weight must be 2D, got ${weight.ndim}D`);
    }
    if (weight.dtype !== "float32") {
      throw new Error(`Embedding: weight dtype must be float32, got ${weight.dtype}`);
    }
    this.numEmbeddings = weight.shape[0]!;
    this.embeddingDim = weight.shape[1]!;
  }

  forward(ids: Tensor): Tensor {
    if (ids.dtype !== "int32" && ids.dtype !== "int64") {
      throw new Error(`Embedding.forward: ids must be int32/int64, got ${ids.dtype}`);
    }
    const w = this.weight.contiguous();
    const wData = w.data as Float32Array;
    const D = this.embeddingDim;

    const outShape = [...ids.shape, D];
    const outSize = ids.size * D;
    const out = new Float32Array(outSize);

    let outIdx = 0;
    for (const idx of iterIndices(ids.shape.length === 0 ? [1] : ids.shape)) {
      const off = ids.shape.length === 0 ? ids.offset : offsetOf(idx, ids.strides, ids.offset);
      const raw = (ids.data as Int32Array | BigInt64Array)[off]!;
      const id = typeof raw === "bigint" ? Number(raw) : raw;
      if (id < 0 || id >= this.numEmbeddings) {
        throw new Error(`Embedding: id ${id} out of range [0, ${this.numEmbeddings})`);
      }
      const src = id * D;
      for (let d = 0; d < D; d++) out[outIdx++] = wData[src + d]!;
    }
    return Tensor.contiguous(out, outShape, "float32");
  }
}

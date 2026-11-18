import { DEFAULT_IGNORE_INDEX, type BackendTensor } from "../../backend/backend";
import type { DeviceTensor } from "../device-tensor";
import { checkIndexRange, hostIndicesOf } from "../index-check";
import { backendOf, expandTo, record, releaseAll } from "../record";

/** Fused NN ops — layernorm, embedding, cross-entropy, LoRA merge — with grad rules. */

export function layerNorm(
  x: DeviceTensor,
  gamma: DeviceTensor | null = null,
  beta: DeviceTensor | null = null,
  eps = 1e-5,
): DeviceTensor {
  const operands = [x, ...(gamma ? [gamma] : []), ...(beta ? [beta] : [])];
  const be = backendOf("layer_norm", ...operands);
  const { y, mean: mu, rstd } = be.layerNorm(x.handle, gamma?.handle ?? null, beta?.handle ?? null, eps);
  const rule = (gy: BackendTensor, needs: readonly boolean[]) => {
    const gammaNeeds = gamma ? needs[1]! : false;
    const betaNeeds = beta ? needs[gamma ? 2 : 1]! : false;
    const r = be.layerNormBackward(x.handle, gamma?.handle ?? null, mu, rstd, gy, gammaNeeds || betaNeeds);
    const out: Array<BackendTensor | null> = [needs[0] ? r.gx : null];
    if (!needs[0]) be.release(r.gx);
    if (gamma) out.push(gammaNeeds ? r.gGamma : null);
    if (beta) out.push(betaNeeds ? r.gBeta : null);
    if (r.gGamma && !gammaNeeds) be.release(r.gGamma);
    if (r.gBeta && !betaNeeds) be.release(r.gBeta);
    return out;
  };
  return record("layer_norm", y, operands, rule, [mu, rstd]);
}

/** weight[ids] — ids is an int32 tensor of any shape; output [...ids.shape, dim]. */
export function embedding(ids: DeviceTensor, weight: DeviceTensor): DeviceTensor {
  const be = backendOf("embedding", weight, ids);
  if (ids.dtype !== "int32") throw new Error(`embedding: ids must be int32, got ${ids.dtype}`);
  const numEmbeddings = weight.shape[0]!;
  checkIndexRange("embedding", ids, numEmbeddings);
  return record("embedding", be.embedding(weight.handle, ids.handle), [weight, ids], (gy) => [
    be.embeddingBackward(ids.handle, gy, numEmbeddings, hostIndicesOf(ids)),
    null,
  ], [], [1]);
}

export type Reduction = "mean" | "sum" | "none";

export interface CrossEntropyOptions {
  reduction?: Reduction;
  /** Targets equal to this contribute no loss or gradient and leave the mean's denominator (PyTorch default -100). */
  ignoreIndex?: number;
}

/**
 * Cross-entropy of logits [N, C] against int32 class targets [N], fused
 * log-softmax + NLL, as ONE recorded op per reduction (no intermediate
 * tensors). Follows PyTorch: "mean" (default) divides by the number of
 * non-ignored targets — all ignored gives NaN, as in PyTorch.
 */
export function crossEntropy(
  logits: DeviceTensor,
  targets: DeviceTensor,
  options: Reduction | CrossEntropyOptions = {},
): DeviceTensor {
  const { reduction = "mean", ignoreIndex = DEFAULT_IGNORE_INDEX } = typeof options === "string" ? { reduction: options } : options;
  const be = backendOf("cross_entropy", logits, targets);
  if (targets.dtype !== "int32") throw new Error(`cross_entropy: targets must be int32, got ${targets.dtype}`);
  checkIndexRange("cross_entropy", targets, logits.shape[logits.shape.length - 1]!, ignoreIndex);
  const N = logits.shape[0]!;
  const { loss, probs, valid } = be.crossEntropy(logits.handle, targets.handle, ignoreIndex);
  const rowsBackward = (gRows: BackendTensor) => be.crossEntropyBackward(probs, targets.handle, gRows, ignoreIndex);

  if (reduction === "none") {
    be.release(valid);
    return record("cross_entropy", loss, [logits, targets], (gy) => [rowsBackward(gy), null], [probs], [1]);
  }
  const total = be.sum(loss, [0], false);
  be.release(loss);
  if (reduction === "sum") {
    be.release(valid);
    return record("cross_entropy", total, [logits, targets], (gy) => {
      const gRows = expandTo(be, gy, [1], [N]);
      const g = rowsBackward(gRows);
      be.release(gRows);
      return [g, null];
    }, [probs], [1]);
  }
  const count = be.sum(valid, [0], false);
  be.release(valid);
  const out = be.binary("div", total, count);
  be.release(total);
  return record("cross_entropy", out, [logits, targets], (gy) => {
    const scaled = be.binary("div", gy, count);
    const gRows = expandTo(be, scaled, [1], [N]);
    const g = rowsBackward(gRows);
    releaseAll(be, scaled, gRows);
    return [g, null];
  }, [probs, count], [1]);
}

/**
 * base + scale · (B A): the merged LoRA weight. base [rows, cols] is normally
 * frozen; A [rank, cols] and B [rows, rank] are the adapters. Runs the moved
 * `LORA_FORWARD_WGSL` / `LORA_BACKWARD_WGSL` kernels on WebGPU.
 */
export function loraMerge(base: DeviceTensor, a: DeviceTensor, b: DeviceTensor, scale: number): DeviceTensor {
  const be = backendOf("lora_merge", base, a, b);
  return record("lora_merge", be.loraMerge(base.handle, a.handle, b.handle, scale), [base, a, b], (gy, needs) => {
    const ga = be.full(a.shape, 0);
    const gb = be.full(b.shape, 0);
    be.loraBackward(gy, a.handle, b.handle, scale, ga, gb);
    const out: Array<BackendTensor | null> = [needs[0] ? be.reshape(gy, base.shape) : null, null, null];
    if (needs[1]) out[1] = ga;
    if (needs[2]) out[2] = gb;
    releaseAll(be, ...(needs[1] ? [] : [ga]), ...(needs[2] ? [] : [gb]));
    return out;
  }, [], [1, 2]);
}

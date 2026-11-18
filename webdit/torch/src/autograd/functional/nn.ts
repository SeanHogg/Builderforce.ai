import type { BackendTensor } from "../../backend/backend";
import type { DeviceTensor } from "../device-tensor";
import { mean, sum } from "./reduce";
import { backendOf, record, releaseAll, saved } from "../record";

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
  const savedMean = saved(be, mu);
  const savedRstd = saved(be, rstd);
  return record("layer_norm", y, operands, (gy, needs) => {
    const gammaNeeds = gamma ? needs[1]! : false;
    const betaNeeds = beta ? needs[gamma ? 2 : 1]! : false;
    const r = be.layerNormBackward(x.handle, gamma?.handle ?? null, savedMean.handle, savedRstd.handle, gy, gammaNeeds || betaNeeds);
    const out: Array<BackendTensor | null> = [needs[0] ? r.gx : null];
    if (!needs[0]) be.release(r.gx);
    if (gamma) out.push(gammaNeeds ? r.gGamma : null);
    if (beta) out.push(betaNeeds ? r.gBeta : null);
    if (r.gGamma && !gammaNeeds) be.release(r.gGamma);
    if (r.gBeta && !betaNeeds) be.release(r.gBeta);
    return out;
  });
}

/** weight[ids] — ids is an int32 tensor of any shape; output [...ids.shape, dim]. */
export function embedding(ids: DeviceTensor, weight: DeviceTensor): DeviceTensor {
  const be = backendOf("embedding", weight, ids);
  if (ids.dtype !== "int32") throw new Error(`embedding: ids must be int32, got ${ids.dtype}`);
  const numEmbeddings = weight.shape[0]!;
  return record("embedding", be.embedding(weight.handle, ids.handle), [weight, ids], (gy) => [
    be.embeddingBackward(ids.handle, gy, numEmbeddings),
    null,
  ]);
}

export type Reduction = "mean" | "sum" | "none";

/**
 * Cross-entropy of logits [N, C] against int32 class targets [N], fused
 * log-softmax + NLL. `reduction` follows PyTorch ("mean" by default).
 */
export function crossEntropy(logits: DeviceTensor, targets: DeviceTensor, reduction: Reduction = "mean"): DeviceTensor {
  const be = backendOf("cross_entropy", logits, targets);
  if (targets.dtype !== "int32") throw new Error(`cross_entropy: targets must be int32, got ${targets.dtype}`);
  const { loss, probs } = be.crossEntropy(logits.handle, targets.handle);
  const savedProbs = saved(be, probs);
  const rows = record("cross_entropy", loss, [logits, targets], (gy) => [
    be.crossEntropyBackward(savedProbs.handle, targets.handle, gy),
    null,
  ]);
  if (reduction === "none") return rows;
  return reduction === "sum" ? sum(rows) : mean(rows);
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
  });
}

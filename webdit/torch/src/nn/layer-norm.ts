import { iterIndices, offsetOf } from "../iter";
import { contiguousStrides } from "../shape";
import { Tensor } from "../tensor";

/**
 * y = (x - mean(x, last_dim)) / sqrt(var(x, last_dim) + eps) * gamma + beta
 *
 * `gamma` and `beta` are 1D of size = last dim of x. Standard PyTorch
 * `nn.LayerNorm` over the trailing dim.
 */
export class LayerNorm {
  readonly normalizedShape: number;

  constructor(
    readonly gamma: Tensor | null,
    readonly beta: Tensor | null,
    readonly eps: number = 1e-5,
  ) {
    if (gamma && gamma.ndim !== 1) {
      throw new Error(`LayerNorm: gamma must be 1D, got ${gamma.ndim}D`);
    }
    if (beta && beta.ndim !== 1) {
      throw new Error(`LayerNorm: beta must be 1D, got ${beta.ndim}D`);
    }
    if (gamma && beta && gamma.shape[0] !== beta.shape[0]) {
      throw new Error("LayerNorm: gamma and beta must have the same length");
    }
    this.normalizedShape = (gamma ?? beta)?.shape[0] ?? 0;
    if (this.normalizedShape === 0) {
      throw new Error("LayerNorm: must provide at least one of gamma or beta");
    }
  }

  forward(x: Tensor): Tensor {
    if (x.dtype !== "float32") throw new Error("LayerNorm: float32 only");
    if (x.shape[x.ndim - 1] !== this.normalizedShape) {
      throw new Error(
        `LayerNorm.forward: last dim ${x.shape[x.ndim - 1]} != ${this.normalizedShape}`,
      );
    }
    const D = this.normalizedShape;
    const out = new Float32Array(x.size);
    const oS = contiguousStrides(x.shape);
    const xData = x.data as Float32Array;
    const gamma = this.gamma ? (this.gamma.contiguous().data as Float32Array) : null;
    const beta = this.beta ? (this.beta.contiguous().data as Float32Array) : null;

    const outerShape = x.shape.slice(0, -1);
    const axisStride = x.strides[x.ndim - 1]!;

    if (outerShape.length === 0) {
      normalizeOne(out, 0, xData, x.offset, axisStride, D, this.eps, gamma, beta);
      return Tensor.contiguous(out, x.shape, "float32");
    }
    for (const idx of iterIndices(outerShape)) {
      const srcBase = offsetOf(idx, x.strides.slice(0, -1), x.offset);
      const dstBase = offsetOf(idx, oS.slice(0, -1), 0);
      normalizeOne(out, dstBase, xData, srcBase, axisStride, D, this.eps, gamma, beta);
    }
    return Tensor.contiguous(out, x.shape, "float32");
  }
}

/**
 * y = x / sqrt(mean(x^2, last_dim) + eps) * gamma   (no mean-centering, no beta)
 */
export class RMSNorm {
  readonly normalizedShape: number;
  constructor(readonly gamma: Tensor, readonly eps: number = 1e-6) {
    if (gamma.ndim !== 1) throw new Error("RMSNorm: gamma must be 1D");
    this.normalizedShape = gamma.shape[0]!;
  }

  forward(x: Tensor): Tensor {
    if (x.dtype !== "float32") throw new Error("RMSNorm: float32 only");
    if (x.shape[x.ndim - 1] !== this.normalizedShape) {
      throw new Error(`RMSNorm.forward: last dim ${x.shape[x.ndim - 1]} != ${this.normalizedShape}`);
    }
    const D = this.normalizedShape;
    const out = new Float32Array(x.size);
    const oS = contiguousStrides(x.shape);
    const xData = x.data as Float32Array;
    const g = this.gamma.contiguous().data as Float32Array;
    const outerShape = x.shape.slice(0, -1);
    const axisStride = x.strides[x.ndim - 1]!;

    const proc = (srcBase: number, dstBase: number): void => {
      let ss = 0;
      for (let d = 0; d < D; d++) {
        const v = xData[srcBase + d * axisStride]!;
        ss += v * v;
      }
      const rms = 1 / Math.sqrt(ss / D + this.eps);
      for (let d = 0; d < D; d++) {
        out[dstBase + d] = xData[srcBase + d * axisStride]! * rms * g[d]!;
      }
    };

    if (outerShape.length === 0) {
      proc(x.offset, 0);
    } else {
      for (const idx of iterIndices(outerShape)) {
        proc(offsetOf(idx, x.strides.slice(0, -1), x.offset), offsetOf(idx, oS.slice(0, -1), 0));
      }
    }
    return Tensor.contiguous(out, x.shape, "float32");
  }
}

function normalizeOne(
  out: Float32Array,
  dstBase: number,
  src: Float32Array,
  srcBase: number,
  srcStride: number,
  D: number,
  eps: number,
  gamma: Float32Array | null,
  beta: Float32Array | null,
): void {
  let mean = 0;
  for (let d = 0; d < D; d++) mean += src[srcBase + d * srcStride]!;
  mean /= D;
  let variance = 0;
  for (let d = 0; d < D; d++) {
    const c = src[srcBase + d * srcStride]! - mean;
    variance += c * c;
  }
  variance /= D;
  const invStd = 1 / Math.sqrt(variance + eps);
  for (let d = 0; d < D; d++) {
    let v = (src[srcBase + d * srcStride]! - mean) * invStd;
    if (gamma) v *= gamma[d]!;
    if (beta) v += beta[d]!;
    out[dstBase + d] = v;
  }
}

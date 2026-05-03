import { iterIndices, offsetOf } from "../iter";
import { contiguousStrides } from "../shape";
import { Tensor } from "../tensor";

/**
 * Rotary Position Embedding (Su et al. 2021). Pre-compute cos/sin tables
 * once per (seqLen, headDim) and reuse across attention layers — that's the
 * whole point of RoPE being position-aware via Q/K rotation.
 *
 *   freqs[d]    = base^(-2d/headDim) for d in 0..headDim/2
 *   angle[s,d]  = s * freqs[d]
 *   cos/sin tables: [seqLen, headDim/2]
 */
export interface RopeFreqs {
  cos: Tensor;
  sin: Tensor;
}

export function ropeFreqs(seqLen: number, headDim: number, base = 10000): RopeFreqs {
  if (headDim % 2 !== 0) throw new Error(`ropeFreqs: headDim must be even, got ${headDim}`);
  const half = headDim / 2;
  const cosData = new Float32Array(seqLen * half);
  const sinData = new Float32Array(seqLen * half);
  for (let s = 0; s < seqLen; s++) {
    for (let d = 0; d < half; d++) {
      const freq = Math.pow(base, (-2 * d) / headDim);
      const angle = s * freq;
      cosData[s * half + d] = Math.cos(angle);
      sinData[s * half + d] = Math.sin(angle);
    }
  }
  return {
    cos: Tensor.contiguous(cosData, [seqLen, half], "float32"),
    sin: Tensor.contiguous(sinData, [seqLen, half], "float32"),
  };
}

/**
 * Apply RoPE to Q or K. `x` shape: [..., seqLen, headDim]. The last dim is
 * paired (even, odd) and rotated by the position-dependent angle.
 *
 *   y[..., 2i]   = x[..., 2i]*cos - x[..., 2i+1]*sin
 *   y[..., 2i+1] = x[..., 2i]*sin + x[..., 2i+1]*cos
 */
export function applyRope(x: Tensor, freqs: RopeFreqs): Tensor {
  if (x.dtype !== "float32") throw new Error("applyRope: float32 only");
  if (x.ndim < 2) throw new Error("applyRope: input must be at least 2D (seq, dim)");
  const headDim = x.shape[x.ndim - 1]!;
  const seqLen = x.shape[x.ndim - 2]!;
  if (headDim % 2 !== 0) throw new Error("applyRope: headDim must be even");
  const cos = freqs.cos.contiguous();
  const sin = freqs.sin.contiguous();
  if (cos.shape[0]! < seqLen || sin.shape[0]! < seqLen) {
    throw new Error(
      `applyRope: rope tables [${cos.shape}] don't cover seqLen ${seqLen}`,
    );
  }
  const half = headDim / 2;

  const out = new Float32Array(x.size);
  const xData = x.data as Float32Array;
  const cosData = cos.data as Float32Array;
  const sinData = sin.data as Float32Array;
  const oS = contiguousStrides(x.shape);
  const lastStride = x.strides[x.ndim - 1]!;
  const seqStride = x.strides[x.ndim - 2]!;

  // Walk every position outside the (seq, dim) plane.
  const outerShape = x.shape.slice(0, -2);
  const outerIter = outerShape.length === 0 ? [[]] : Array.from(iterIndices(outerShape));

  for (const outer of outerIter as number[][]) {
    const xOuterOff = offsetOf(outer, x.strides.slice(0, -2), x.offset);
    const oOuterOff = offsetOf(outer, oS.slice(0, -2), 0);
    for (let s = 0; s < seqLen; s++) {
      const cosBase = s * half;
      const sinBase = s * half;
      const xRow = xOuterOff + s * seqStride;
      const oRow = oOuterOff + s * (oS[oS.length - 2] ?? headDim);
      for (let i = 0; i < half; i++) {
        const a = xData[xRow + 2 * i * lastStride]!;
        const b = xData[xRow + (2 * i + 1) * lastStride]!;
        const c = cosData[cosBase + i]!;
        const sn = sinData[sinBase + i]!;
        out[oRow + 2 * i] = a * c - b * sn;
        out[oRow + 2 * i + 1] = a * sn + b * c;
      }
    }
  }
  return Tensor.contiguous(out, x.shape, "float32");
}

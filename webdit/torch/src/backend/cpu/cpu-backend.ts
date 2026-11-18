import { full } from "../../creation";
import { softmax, gelu, relu } from "../../ops/activation";
import { add, binaryF32, div, exp, log, mul, sub, unaryF32 } from "../../ops/elementwise";
import { matmul } from "../../ops/matmul";
import { sum } from "../../ops/reduction";
import { reshape, transpose } from "../../ops/shape";
import { Embedding } from "../../nn/embedding";
import { productOf, type Shape } from "../../shape";
import { Tensor } from "../../tensor";
import type { AdamWStep, Backend, BinaryOp, EngineDType, HostArray, SgdStep, UnaryOp } from "../backend";
import { matmulShape, reducePlan } from "../shape-rules";
import * as rows from "./row-kernels";
import * as updates from "./update-kernels";

const GELU_C = Math.sqrt(2 / Math.PI);

/** d/dx of the tanh-approximated GELU that `ops/activation.gelu` computes. */
export function geluGrad(x: number): number {
  const u = GELU_C * (x + 0.044715 * x * x * x);
  const t = Math.tanh(u);
  return 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * GELU_C * (1 + 3 * 0.044715 * x * x);
}

/**
 * The reference backend. Handles are the library's own CPU `Tensor`s, so the
 * forward math is the same code the inference path (`ops/*`, `nn/*`) runs;
 * only the backward/update kernels are new, in `row-kernels.ts` and
 * `update-kernels.ts`.
 */
export class CpuBackend implements Backend<Tensor> {
  readonly name = "cpu" as const;
  readonly supportsF16 = false;

  upload(data: HostArray, shape: Shape, dtype: EngineDType): Tensor {
    if (data.length !== productOf(shape)) {
      throw new Error(`upload: ${data.length} values for shape ${JSON.stringify(shape)}`);
    }
    const copy = dtype === "int32" ? Int32Array.from(data) : Float32Array.from(data);
    return Tensor.contiguous(copy, shape, dtype);
  }

  download(h: Tensor): Promise<HostArray> {
    const c = h.contiguous();
    const out = c.dtype === "int32" ? Int32Array.from(c.data as Int32Array) : Float32Array.from(c.data as Float32Array);
    return Promise.resolve(out);
  }

  release(): void {
    // Garbage-collected storage: nothing to return.
  }

  full(shape: Shape, value: number): Tensor {
    return full(shape, value);
  }

  reshape(a: Tensor, shape: Shape): Tensor {
    return reshape(a, shape);
  }

  stridedCopy(a: Tensor, shape: Shape, strides: Shape, offset: number): Tensor {
    const src = a.contiguous();
    return new Tensor(src.data, shape, strides, src.offset + offset, src.dtype).contiguous();
  }

  unary(op: UnaryOp, a: Tensor): Tensor {
    switch (op) {
      case "relu":
        return relu(a);
      case "gelu":
        return gelu(a);
      case "exp":
        return exp(a);
      case "log":
        return log(a);
    }
  }

  affine(a: Tensor, scale: number, shift: number): Tensor {
    return unaryF32(a, (x) => x * scale + shift, "affine");
  }

  binary(op: BinaryOp, a: Tensor, b: Tensor): Tensor {
    switch (op) {
      case "add":
        return add(a, b);
      case "sub":
        return sub(a, b);
      case "mul":
        return mul(a, b);
      case "div":
        return div(a, b);
      case "relu_backward":
        return binaryF32(a, b, (x, g) => (x > 0 ? g : 0), "relu_backward");
      case "gelu_backward":
        return binaryF32(a, b, (x, g) => g * geluGrad(x), "gelu_backward");
    }
  }

  matmul(a: Tensor, b: Tensor, transA: boolean, transB: boolean): Tensor {
    matmulShape(a.shape, b.shape, transA, transB);
    return matmul(transA ? transpose(a, -2, -1) : a, transB ? transpose(b, -2, -1) : b);
  }

  sum(a: Tensor, axes: ReadonlyArray<number>, keepDims: boolean): Tensor {
    const plan = reducePlan(a.shape, axes, keepDims);
    if (plan.axes.length === 0) return reshape(a, plan.outShape);
    return sum(a, plan.axes, keepDims);
  }

  softmax(a: Tensor): Tensor {
    return softmax(a, -1);
  }
  softmaxBackward(y: Tensor, gy: Tensor): Tensor {
    return rows.softmaxBackward(y, gy);
  }
  logSoftmax(a: Tensor): Tensor {
    return rows.logSoftmax(a);
  }
  logSoftmaxBackward(y: Tensor, gy: Tensor): Tensor {
    return rows.logSoftmaxBackward(y, gy);
  }
  layerNorm(x: Tensor, gamma: Tensor | null, beta: Tensor | null, eps: number) {
    return rows.layerNorm(x, gamma, beta, eps);
  }
  layerNormBackward(x: Tensor, gamma: Tensor | null, mean: Tensor, rstd: Tensor, gy: Tensor, withAffine: boolean) {
    return rows.layerNormBackward(x, gamma, mean, rstd, gy, withAffine);
  }
  embedding(weight: Tensor, ids: Tensor): Tensor {
    return new Embedding(weight).forward(ids);
  }
  embeddingBackward(ids: Tensor, gy: Tensor, numEmbeddings: number): Tensor {
    return rows.embeddingBackward(ids, gy, numEmbeddings);
  }
  crossEntropy(logits: Tensor, targets: Tensor, ignoreIndex: number) {
    return rows.crossEntropy(logits, targets, ignoreIndex);
  }
  crossEntropyBackward(probs: Tensor, targets: Tensor, gLoss: Tensor, ignoreIndex: number): Tensor {
    return rows.crossEntropyBackward(probs, targets, gLoss, ignoreIndex);
  }
  addInPlace(target: Tensor, src: Tensor): void {
    updates.addInPlace(target, src);
  }

  loraMerge(base: Tensor, a: Tensor, b: Tensor, scale: number): Tensor {
    return updates.loraMerge(base, a, b, scale);
  }
  loraBackward(gw: Tensor, a: Tensor, b: Tensor, scale: number, ga: Tensor, gb: Tensor): void {
    updates.loraBackward(gw, a, b, scale, ga, gb);
  }
  adamwStep(param: Tensor, grad: Tensor, m: Tensor, v: Tensor, step: AdamWStep): void {
    updates.adamwStep(param, grad, m, v, step);
  }
  sgdStep(param: Tensor, grad: Tensor, momentumBuf: Tensor | null, step: SgdStep): void {
    updates.sgdStep(param, grad, momentumBuf, step);
  }
}

/** The process-wide CPU backend; it holds no state, so one instance serves everyone. */
export const cpu = new CpuBackend();

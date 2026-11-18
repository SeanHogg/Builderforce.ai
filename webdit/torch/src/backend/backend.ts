import type { Shape } from "../shape";

/**
 * The ONE compute port of the training engine. Autograd (`../autograd`) is
 * written against this interface only, so every grad rule runs unchanged on
 * every backend; the CPU backend is the reference the WebGPU backend is held to.
 *
 * Contract every implementation keeps:
 *  - every handle a method returns is a fresh, CONTIGUOUS row-major tensor;
 *  - every method except `download` is synchronous (WebGPU enqueues, it never
 *    waits) — readback is the only await, and it is explicit;
 *  - `release` gives a handle's storage back (pooled on WebGPU); a handle is
 *    never used after it is released;
 *  - in-place methods (`*Step`, `loraBackward`, `addInPlace`, `copyInPlace`) mutate the handles they name and
 *    nothing else.
 */

export type EngineDType = "float32" | "int32";
export type HostArray = Float32Array | Int32Array;

/** What every backend handle exposes: enough for shape-checking above the port. */
export interface BackendTensor {
  readonly shape: Shape;
  readonly dtype: string;
}

/** `gelu` is the tanh approximation; `gelu_erf` the exact (erf) GELU, PyTorch's default. */
export type UnaryOp = "relu" | "gelu" | "gelu_erf" | "exp" | "log";

/**
 * Broadcasting binary ops. `relu_backward` / `gelu_backward` /
 * `gelu_erf_backward` take `(x, gy)` of the same shape and return the input gradient.
 */
export type BinaryOp = "add" | "sub" | "mul" | "div" | "relu_backward" | "gelu_backward" | "gelu_erf_backward";

export interface LayerNormForward<H> {
  y: H;
  /** Per-row statistics, shape = x.shape without the last dim. */
  mean: H;
  rstd: H;
}

export interface LayerNormBackward<H> {
  gx: H;
  gGamma: H | null;
  gBeta: H | null;
}

export interface CrossEntropyForward<H> {
  /** Per-row loss, shape [N]; 0 where the target is `ignoreIndex`. */
  loss: H;
  /** Softmax of the logits, shape [N, C] — the backward reads it. */
  probs: H;
  /** 1 per counted row, 0 per ignored row, shape [N] — the mean's denominator. */
  valid: H;
}

/** PyTorch's default `ignore_index`. */
export const DEFAULT_IGNORE_INDEX = -100;

/**
 * One AdamW update. The field layout mirrors the `p[4..10]` slots of
 * `ADAMW_WGSL`, which this step drives verbatim on WebGPU.
 */
export interface AdamWStep {
  lr: number;
  beta1: number;
  beta2: number;
  eps: number;
  weightDecay: number;
  /** Multiplies the gradient before the update (1 / accumulated micro-batches). */
  gradScale: number;
  /** 1-based step count of THIS parameter, for bias correction. */
  step: number;
  /**
   * Leave the gradient intact (PyTorch semantics; `zeroGrad()` clears it).
   * False reproduces the browser trainer's accumulate-then-consume contract:
   * the kernel zeroes the gradient. Drives `ADAMW_WGSL`'s `p[11]` slot.
   */
  keepGrad: boolean;
}

export interface SgdStep {
  lr: number;
  momentum: number;
  weightDecay: number;
}

export interface Backend<H extends BackendTensor = BackendTensor> {
  readonly name: "cpu" | "webgpu";
  /** True when the backend can hold fp16 storage (WebGPU `shader-f16`). */
  readonly supportsF16: boolean;

  upload(data: HostArray, shape: Shape, dtype: EngineDType): H;
  /** Async readback — the only awaited call on the port. */
  download(h: H): Promise<HostArray>;
  release(h: H): void;

  full(shape: Shape, value: number): H;
  /** Contiguous view with a new shape; may share storage with `a`. */
  reshape(a: H, shape: Shape): H;
  /** Materialize the strided view (shape, strides, offset) of contiguous `a`. Stride 0 broadcasts. */
  stridedCopy(a: H, shape: Shape, strides: Shape, offset: number): H;

  unary(op: UnaryOp, a: H): H;
  /** `a * scale + shift`. */
  affine(a: H, scale: number, shift: number): H;
  binary(op: BinaryOp, a: H, b: H): H;
  /** target += src, in place (same shape) — gradient accumulation into `.grad`. */
  addInPlace(target: H, src: H): void;
  /**
   * target ← src in place, bit-exact (same size and dtype) — `Tensor.copy_`,
   * `load_state_dict`. A no-op when both handles share storage (a view of
   * itself), so copying a tensor onto an alias of itself never corrupts it.
   */
  copyInPlace(target: H, src: H): void;
  /** A fresh float32 ⇄ int32 conversion (float → int truncates toward zero, as PyTorch). */
  cast(a: H, dtype: EngineDType): H;
  /**
   * Batched matmul over the last two dims. `transA` / `transB` swap an
   * operand's last two dims. Batch dims must be equal, or one operand 2D.
   */
  matmul(a: H, b: H, transA: boolean, transB: boolean): H;
  sum(a: H, axes: ReadonlyArray<number>, keepDims: boolean): H;

  softmax(a: H): H;
  softmaxBackward(y: H, gy: H): H;
  logSoftmax(a: H): H;
  logSoftmaxBackward(y: H, gy: H): H;
  layerNorm(x: H, gamma: H | null, beta: H | null, eps: number): LayerNormForward<H>;
  layerNormBackward(x: H, gamma: H | null, mean: H, rstd: H, gy: H, withAffine: boolean): LayerNormBackward<H>;
  embedding(weight: H, ids: H): H;
  /**
   * Scatter-add of `gy` rows into a [numEmbeddings, dim] gradient. `hostIds` —
   * the id values when the host knows them — lets a backend group positions by
   * row up front; without them it must scatter on the device. Out-of-range ids
   * contribute nothing.
   */
  embeddingBackward(ids: H, gy: H, numEmbeddings: number, hostIds: Int32Array | null): H;
  crossEntropy(logits: H, targets: H, ignoreIndex: number): CrossEntropyForward<H>;
  /** (probs - onehot(targets)) * gLoss[row]; zero rows where the target is `ignoreIndex`. */
  crossEntropyBackward(probs: H, targets: H, gLoss: H, ignoreIndex: number): H;

  /** base + scale · (b @ a), with a [rank, cols] and b [rows, rank]. */
  loraMerge(base: H, a: H, b: H, scale: number): H;
  /** ga += scale · bᵀ gw ; gb += scale · gw aᵀ (in place). */
  loraBackward(gw: H, a: H, b: H, scale: number, ga: H, gb: H): void;
  /** In-place AdamW on (param, m, v); the gradient is zeroed only when `step.keepGrad` is false. */
  adamwStep(param: H, grad: H, m: H, v: H, step: AdamWStep): void;
  /** In-place SGD (with optional momentum buffer). */
  sgdStep(param: H, grad: H, momentumBuf: H | null, step: SgdStep): void;
}

/** Error raised for an op a backend or the engine surface does not cover — always names the op. */
export class UnsupportedOpError extends Error {
  constructor(readonly op: string, detail: string) {
    super(`${op}: ${detail}`);
    this.name = "UnsupportedOpError";
  }
}

import { contiguousStrides, productOf, type Shape } from "../../shape";
import type {
  AdamWStep,
  Backend,
  BinaryOp,
  CrossEntropyForward,
  EngineDType,
  HostArray,
  LayerNormBackward,
  LayerNormForward,
  SgdStep,
  UnaryOp,
} from "../backend";
import { matmulShape, rowsOf, sameShape } from "../shape-rules";
import { BufferPool, type PoolStats } from "./buffer-pool";
import { requestEngineDevice, type EngineDevice, type WebGPUDeviceOptions } from "./device";
import { DeviceHealth } from "./device-health";
import { Dispatcher, type Binding } from "./dispatcher";
import { buildCsr } from "./embedding-csr";
import { dataBytes, GpuTensor, type GpuDType } from "./gpu-tensor";
import { TRAINER_PARAM_FLOATS } from "./kernels/optim";
import { binaryParams, copyParams, floatBits, sumParams } from "./param-blocks";

const u32 = (...values: number[]) => Uint32Array.from(values);

export interface WebGPUBackendOptions {
  /** VRAM budget for live tensors (`VramBudgetError` past it). */
  maxBytes?: number;
  /** Idle pooled bytes kept before trimming (default 256 MiB). */
  maxPooledBytes?: number;
  /** The backend created the device and may destroy it (`createWebGPUBackend` sets this). */
  ownsDevice?: boolean;
}
const bind = (t: GpuTensor): Binding => ({ buffer: t.buffer, bytes: t.bytes });

/**
 * The WebGPU backend: GPU-resident tensors over pooled buffers, every op a
 * registry kernel. Enqueue is synchronous; `download` is the only await.
 */
export class WebGPUBackend implements Backend<GpuTensor> {
  readonly name = "webgpu" as const;
  readonly supportsF16: boolean;
  readonly device: GPUDevice;
  readonly adapterDescription: string;
  readonly health: DeviceHealth;
  private readonly pool: BufferPool;
  private readonly dispatcher: Dispatcher;
  private readonly ownsDevice: boolean;
  /** 1-word placeholder bound where an optional operand is absent. */
  private readonly dummy: GpuTensor;

  constructor(
    readonly engine: EngineDevice,
    options: WebGPUBackendOptions = {},
  ) {
    this.device = engine.device;
    this.supportsF16 = engine.f16;
    this.adapterDescription = engine.adapterDescription;
    this.ownsDevice = options.ownsDevice ?? false;
    this.health = new DeviceHealth(engine.device);
    this.pool = new BufferPool(engine.device, options.maxBytes, options.maxPooledBytes);
    this.dispatcher = new Dispatcher(engine.device, this.pool, new Set(engine.device.features), this.health);
    this.dummy = this.alloc([1], "float32");
  }

  stats(): PoolStats {
    return this.pool.stats();
  }

  /** Free pooled buffers, and destroy the device only if this backend created it. */
  destroy(): void {
    this.pool.trim();
    if (this.ownsDevice) {
      this.health.markDestroying();
      this.device.destroy();
    }
  }

  private alloc(shape: Shape, dtype: GpuDType = "float32"): GpuTensor {
    return new GpuTensor({ buffer: this.pool.acquire(Math.max(4, dataBytes(shape, dtype))), refs: 1 }, [...shape], dtype);
  }

  upload(data: HostArray, shape: Shape, dtype: EngineDType): GpuTensor {
    if (data.length !== productOf(shape)) throw new Error(`upload: ${data.length} values for shape ${JSON.stringify(shape)}`);
    const t = this.alloc(shape, dtype);
    if (data.length > 0) this.dispatcher.write(t.buffer, data);
    return t;
  }

  async download(h: GpuTensor): Promise<HostArray> {
    if (h.dtype === "float16") throw new Error("download: packed fp16 storage — convert with fromF16 first");
    const bytes = await this.dispatcher.read(h.buffer, h.size * 4);
    return h.dtype === "int32" ? new Int32Array(bytes) : new Float32Array(bytes);
  }

  release(h: GpuTensor): void {
    if (h.released) return;
    h.released = true;
    h.storage.refs -= 1;
    if (h.storage.refs === 0) this.pool.release(h.storage.buffer);
  }

  full(shape: Shape, value: number): GpuTensor {
    return this.upload(new Float32Array(productOf(shape)).fill(value), shape, "float32");
  }

  reshape(a: GpuTensor, shape: Shape): GpuTensor {
    if (productOf(shape) !== a.size) throw new Error(`reshape: ${JSON.stringify(shape)} does not hold ${a.size} elements`);
    a.storage.refs += 1;
    return new GpuTensor(a.storage, [...shape], a.dtype);
  }

  stridedCopy(a: GpuTensor, shape: Shape, strides: Shape, offset: number): GpuTensor {
    const out = this.alloc(shape, a.dtype);
    this.dispatcher.run("strided_copy", [bind(a), bind(out)], copyParams(shape, strides, offset), out.size);
    return out;
  }

  unary(op: UnaryOp, a: GpuTensor): GpuTensor {
    const out = this.alloc(a.shape);
    this.dispatcher.run(op, [bind(a), bind(out)], u32(a.size, 0, 0), a.size);
    return out;
  }

  affine(a: GpuTensor, scale: number, shift: number): GpuTensor {
    const out = this.alloc(a.shape);
    this.dispatcher.run("affine", [bind(a), bind(out)], u32(a.size, floatBits(scale), floatBits(shift)), a.size);
    return out;
  }

  binary(op: BinaryOp, a: GpuTensor, b: GpuTensor): GpuTensor {
    const { params, outShape } = binaryParams(a.shape, b.shape, op);
    const out = this.alloc(outShape);
    this.dispatcher.run(op, [bind(a), bind(b), bind(out)], params, out.size);
    return out;
  }

  addInPlace(target: GpuTensor, src: GpuTensor): void {
    if (target.size !== src.size) throw new Error(`add_inplace: ${src.size} values into ${target.size}`);
    this.dispatcher.run("add_inplace", [bind(target), bind(src)], u32(target.size), target.size);
  }

  copyInPlace(target: GpuTensor, src: GpuTensor): void {
    if (target.dtype !== src.dtype) throw new Error(`copy_inplace: ${src.dtype} into ${target.dtype}`);
    if (target.size !== src.size) throw new Error(`copy_inplace: ${src.size} values into ${target.size}`);
    // Views of one storage hold the same values; binding one buffer read and read_write is also invalid.
    if (target.storage === src.storage || target.size === 0) return;
    this.dispatcher.run("copy_inplace", [bind(target), bind(src)], u32(target.size), target.size);
  }

  cast(a: GpuTensor, dtype: EngineDType): GpuTensor {
    if (a.dtype === "float16") throw new Error("cast: packed fp16 storage — convert with fromF16 first");
    if (a.dtype === dtype) return this.stridedCopy(a, a.shape, contiguousStrides(a.shape), 0);
    const out = this.alloc(a.shape, dtype);
    if (a.size > 0) this.dispatcher.run(dtype === "int32" ? "cast_f32_to_i32" : "cast_i32_to_f32", [bind(a), bind(out)], u32(a.size), a.size);
    return out;
  }

  matmul(a: GpuTensor, b: GpuTensor, transA: boolean, transB: boolean): GpuTensor {
    const s = matmulShape(a.shape, b.shape, transA, transB);
    const out = this.alloc(s.outShape);
    const aR = a.shape[a.shape.length - 2]!;
    const aC = a.shape[a.shape.length - 1]!;
    const bR = b.shape[b.shape.length - 2]!;
    const bC = b.shape[b.shape.length - 1]!;
    const batch = productOf(s.batch);
    const params = u32(
      s.M,
      s.N,
      s.K,
      batch,
      s.aBatched ? aR * aC : 0,
      s.bBatched ? bR * bC : 0,
      transA ? 1 : aC, // a: stride between output rows (m)
      transA ? aC : 1, // a: stride along k
      transB ? 1 : bC, // b: stride along k
      transB ? bC : 1, // b: stride between output cols (n)
    );
    this.dispatcher.run("matmul", [bind(a), bind(b), bind(out)], params, out.size);
    return out;
  }

  sum(a: GpuTensor, axes: ReadonlyArray<number>, keepDims: boolean): GpuTensor {
    const { params, outShape } = sumParams(a.shape, axes, keepDims);
    const out = this.alloc(outShape);
    this.dispatcher.run("sum", [bind(a), bind(out)], params, out.size);
    return out;
  }

  private rowOp(name: "softmax" | "log_softmax", a: GpuTensor): GpuTensor {
    const { rows, cols } = rowsOf(a.shape, name);
    const out = this.alloc(a.shape);
    this.dispatcher.run(name, [bind(a), bind(out)], u32(rows, cols), rows);
    return out;
  }

  private rowBackward(name: "softmax_backward" | "log_softmax_backward", y: GpuTensor, gy: GpuTensor): GpuTensor {
    sameShape(y.shape, gy.shape, name);
    const { rows, cols } = rowsOf(y.shape, name);
    const out = this.alloc(y.shape);
    this.dispatcher.run(name, [bind(y), bind(gy), bind(out)], u32(rows, cols), rows);
    return out;
  }

  softmax(a: GpuTensor): GpuTensor {
    return this.rowOp("softmax", a);
  }
  softmaxBackward(y: GpuTensor, gy: GpuTensor): GpuTensor {
    return this.rowBackward("softmax_backward", y, gy);
  }
  logSoftmax(a: GpuTensor): GpuTensor {
    return this.rowOp("log_softmax", a);
  }
  logSoftmaxBackward(y: GpuTensor, gy: GpuTensor): GpuTensor {
    return this.rowBackward("log_softmax_backward", y, gy);
  }

  layerNorm(x: GpuTensor, gamma: GpuTensor | null, beta: GpuTensor | null, eps: number): LayerNormForward<GpuTensor> {
    const { rows, cols } = rowsOf(x.shape, "layer_norm");
    const statShape = x.shape.slice(0, -1);
    const y = this.alloc(x.shape);
    const mean = this.alloc(statShape);
    const rstd = this.alloc(statShape);
    const params = u32(rows, cols, floatBits(eps), gamma ? 1 : 0, beta ? 1 : 0);
    const g = gamma ?? this.dummy;
    const b = beta ?? this.dummy;
    this.dispatcher.run("layer_norm", [bind(x), bind(g), bind(b), bind(y), bind(mean), bind(rstd)], params, rows);
    return { y, mean, rstd };
  }

  layerNormBackward(
    x: GpuTensor,
    gamma: GpuTensor | null,
    mean: GpuTensor,
    rstd: GpuTensor,
    gy: GpuTensor,
    withAffine: boolean,
  ): LayerNormBackward<GpuTensor> {
    const { rows, cols } = rowsOf(x.shape, "layer_norm_backward");
    const gx = this.alloc(x.shape);
    const g = gamma ?? this.dummy;
    this.dispatcher.run(
      "layer_norm_backward",
      [bind(x), bind(g), bind(mean), bind(rstd), bind(gy), bind(gx)],
      u32(rows, cols, gamma ? 1 : 0),
      rows,
    );
    if (!withAffine) return { gx, gGamma: null, gBeta: null };
    const gGamma = this.alloc([cols]);
    const gBeta = this.alloc([cols]);
    this.dispatcher.run(
      "layer_norm_affine_backward",
      [bind(x), bind(mean), bind(rstd), bind(gy), bind(gGamma), bind(gBeta)],
      u32(rows, cols),
      cols,
    );
    return { gx, gGamma, gBeta };
  }

  embedding(weight: GpuTensor, ids: GpuTensor): GpuTensor {
    const [vocab, dim] = [weight.shape[0]!, weight.shape[1]!];
    const out = this.alloc([...ids.shape, dim]);
    this.dispatcher.run("embedding", [bind(weight), bind(ids), bind(out)], u32(out.size, dim, vocab), out.size);
    return out;
  }

  embeddingBackward(ids: GpuTensor, gy: GpuTensor, numEmbeddings: number, hostIds: Int32Array | null): GpuTensor {
    const dim = gy.shape[gy.shape.length - 1]!;
    if (!hostIds) {
      const out = this.full([numEmbeddings, dim], 0);
      this.dispatcher.run("embedding_backward_atomic", [bind(ids), bind(gy), bind(out)], u32(ids.size, dim, numEmbeddings), ids.size * dim);
      return out;
    }
    const { rowStart, positions } = buildCsr(hostIds, numEmbeddings);
    const starts = this.upload(rowStart, [rowStart.length], "int32");
    const pos = this.upload(positions, [positions.length], "int32");
    const out = this.alloc([numEmbeddings, dim]);
    this.dispatcher.run("embedding_backward_csr", [bind(starts), bind(pos), bind(gy), bind(out)], u32(numEmbeddings, dim), out.size);
    this.release(starts);
    this.release(pos);
    return out;
  }

  crossEntropy(logits: GpuTensor, targets: GpuTensor, ignoreIndex: number): CrossEntropyForward<GpuTensor> {
    if (logits.shape.length !== 2) throw new Error("cross_entropy: logits must be [N, C]");
    const [N, C] = [logits.shape[0]!, logits.shape[1]!];
    if (targets.size !== N) throw new Error(`cross_entropy: ${targets.size} targets for ${N} rows`);
    const loss = this.alloc([N]);
    const probs = this.alloc([N, C]);
    const valid = this.alloc([N]);
    this.dispatcher.run(
      "cross_entropy",
      [bind(logits), bind(targets), bind(loss), bind(probs), bind(valid)],
      u32(N, C, ignoreIndex >>> 0),
      N,
    );
    return { loss, probs, valid };
  }

  crossEntropyBackward(probs: GpuTensor, targets: GpuTensor, gLoss: GpuTensor, ignoreIndex: number): GpuTensor {
    const [N, C] = [probs.shape[0]!, probs.shape[1]!];
    const out = this.alloc([N, C]);
    this.dispatcher.run(
      "cross_entropy_backward",
      [bind(probs), bind(targets), bind(gLoss), bind(out)],
      u32(N, C, ignoreIndex >>> 0),
      N * C,
    );
    return out;
  }

  private loraParams(rows: number, cols: number, rank: number, scale: number): Float32Array {
    const p = new Float32Array(TRAINER_PARAM_FLOATS);
    p.set([rows, cols, rank, scale]);
    return p;
  }

  loraMerge(base: GpuTensor, a: GpuTensor, b: GpuTensor, scale: number): GpuTensor {
    const [rows, cols] = [base.shape[0]!, base.shape[1]!];
    const rank = a.shape[0]!;
    const out = this.alloc([rows, cols]);
    this.dispatcher.run("lora_forward", [bind(base), bind(a), bind(b), bind(out)], this.loraParams(rows, cols, rank, scale), rows * cols);
    return out;
  }

  loraBackward(gw: GpuTensor, a: GpuTensor, b: GpuTensor, scale: number, ga: GpuTensor, gb: GpuTensor): void {
    const [rows, cols] = [gw.shape[0]!, gw.shape[1]!];
    const rank = a.shape[0]!;
    this.dispatcher.run(
      "lora_backward",
      [bind(gw), bind(a), bind(b), bind(ga), bind(gb)],
      this.loraParams(rows, cols, rank, scale),
      Math.max(a.size, b.size),
    );
  }

  adamwStep(param: GpuTensor, grad: GpuTensor, m: GpuTensor, v: GpuTensor, s: AdamWStep): void {
    const p = new Float32Array(TRAINER_PARAM_FLOATS);
    p.set([s.lr, s.beta1, s.beta2, s.eps, s.weightDecay, s.gradScale, s.step, s.keepGrad ? 1 : 0], 4);
    this.dispatcher.run("adamw", [bind(param), bind(grad), bind(m), bind(v)], p, param.size);
  }

  sgdStep(param: GpuTensor, grad: GpuTensor, momentumBuf: GpuTensor | null, s: SgdStep): void {
    const p = Float32Array.from([s.lr, s.momentum, s.weightDecay, momentumBuf ? 1 : 0]);
    this.dispatcher.run("sgd", [bind(param), bind(grad), bind(momentumBuf ?? this.dummy)], p, param.size);
  }

  /**
   * fp32 → packed fp16 storage (needs `shader-f16`): a `float16`-labelled handle
   * of the same shape at half the bytes, for a frozen weight. Not computable —
   * `fromF16` converts it back.
   */
  toF16(a: GpuTensor): GpuTensor {
    if (a.dtype !== "float32") throw new Error(`toF16: expected float32, got ${a.dtype}`);
    const out = this.alloc(a.shape, "float16");
    this.dispatcher.run("cast_f32_to_f16", [bind(a), bind(out)], u32(a.size), Math.ceil(a.size / 2));
    return out;
  }

  /** Packed fp16 storage → float32 tensor of the same shape (or `shape`, same element count). */
  fromF16(packed: GpuTensor, shape: Shape = packed.shape): GpuTensor {
    if (packed.dtype !== "float16") throw new Error(`fromF16: expected a float16 handle, got ${packed.dtype}`);
    if (productOf(shape) !== packed.size) {
      throw new Error(`fromF16: shape ${JSON.stringify(shape)} does not hold the ${packed.size} packed values`);
    }
    const out = this.alloc(shape);
    this.dispatcher.run("cast_f16_to_f32", [bind(packed), bind(out)], u32(out.size), out.size);
    return out;
  }
}

/**
 * Acquire a device (window or Worker; never needs SharedArrayBuffer) and build
 * the backend on it. The backend owns that device: `destroy()` destroys it.
 */
export async function createWebGPUBackend(
  options: WebGPUDeviceOptions & Omit<WebGPUBackendOptions, "ownsDevice"> = {},
): Promise<WebGPUBackend> {
  return new WebGPUBackend(await requestEngineDevice(options), {
    maxBytes: options.maxBytes,
    maxPooledBytes: options.maxPooledBytes,
    ownsDevice: true,
  });
}

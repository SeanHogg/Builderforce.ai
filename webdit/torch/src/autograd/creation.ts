import type { Backend } from "../backend/backend";
import { cpu } from "../backend/cpu/cpu-backend";
import { rand as cpuRand, randn as cpuRandn } from "../creation";
import { productOf, type Shape } from "../shape";
import type { Tensor } from "../tensor";
import { DeviceTensor, type AnyBackend } from "./device-tensor";
import { rememberHostIndices } from "./index-check";

/**
 * Engine tensor constructors (`torch.tensor` / `zeros` / `randn` …). Each takes
 * the backend to live on (CPU by default) and whether it requires grad.
 * Random draws are seeded: an explicit `seed`, or the next seed from
 * `manualSeed`'s generator, so a fixed seed fixes a whole run.
 */

export interface TensorOptions {
  backend?: AnyBackend;
  requiresGrad?: boolean;
}

let seedState = 0x2f6b_1e3d;

/** Reset the engine's seed stream (PyTorch `torch.manual_seed`). */
export function manualSeed(seed: number): void {
  seedState = seed >>> 0 || 1;
}

/** Next seed from the stream (xorshift32); deterministic after `manualSeed`. */
export function nextSeed(): number {
  let x = seedState;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  seedState = x >>> 0;
  return seedState;
}

const make = (data: Float32Array | Int32Array, shape: Shape, dtype: "float32" | "int32", o: TensorOptions = {}) => {
  const backend = o.backend ?? cpu;
  const t = new DeviceTensor(backend, backend.upload(data, shape, dtype), false);
  if (dtype === "int32") rememberHostIndices(t, Int32Array.from(data));
  return o.requiresGrad ? t.setRequiresGrad(true) : t;
};

export function tensor(data: ArrayLike<number>, shape: Shape, options?: TensorOptions): DeviceTensor {
  return make(Float32Array.from(data), shape, "float32", options);
}

export function intTensor(data: ArrayLike<number>, shape: Shape, options?: TensorOptions): DeviceTensor {
  return make(Int32Array.from(data), shape, "int32", options);
}

export function zeros(shape: Shape, options?: TensorOptions): DeviceTensor {
  return make(new Float32Array(productOf(shape)), shape, "float32", options);
}

export function ones(shape: Shape, options?: TensorOptions): DeviceTensor {
  return make(new Float32Array(productOf(shape)).fill(1), shape, "float32", options);
}

export function randn(shape: Shape, options: TensorOptions & { seed?: number; std?: number } = {}): DeviceTensor {
  const data = cpuRandn(shape, options.seed ?? nextSeed()).data as Float32Array;
  if (options.std !== undefined) for (let i = 0; i < data.length; i++) data[i]! *= options.std;
  return make(data, shape, "float32", options);
}

/** Uniform on [low, high). */
export function uniform(shape: Shape, low: number, high: number, options: TensorOptions & { seed?: number } = {}): DeviceTensor {
  const data = cpuRand(shape, options.seed ?? nextSeed()).data as Float32Array;
  for (let i = 0; i < data.length; i++) data[i] = low + (high - low) * data[i]!;
  return make(data, shape, "float32", options);
}

/** Wrap a CPU inference `Tensor` (float32 or integer) as an engine tensor. */
export function fromTensor(t: Tensor, options?: TensorOptions): DeviceTensor {
  const c = t.contiguous();
  if (c.dtype === "float32") return make(c.data as Float32Array, c.shape, "float32", options);
  const ints = c.dtype === "int64" ? Int32Array.from(c.data as BigInt64Array, (v) => Number(v)) : (c.data as Int32Array);
  return make(ints, c.shape, "int32", options);
}

/** Copy a tensor to another backend (async: it reads the values back). Graph-free. */
export async function toBackend(t: DeviceTensor, backend: Backend, options: { requiresGrad?: boolean } = {}): Promise<DeviceTensor> {
  const data = await t.data();
  return make(data, t.shape, t.dtype === "int32" ? "int32" : "float32", { backend, requiresGrad: options.requiresGrad });
}

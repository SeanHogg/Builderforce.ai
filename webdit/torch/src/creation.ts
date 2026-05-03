import { type AnyTypedArray, type DType, newTypedArray } from "./dtype";
import { contiguousStrides, productOf, type Shape } from "./shape";
import { Tensor } from "./tensor";

export function zeros(shape: Shape, dtype: DType = "float32"): Tensor {
  return Tensor.contiguous(newTypedArray(dtype, productOf(shape)), shape, dtype);
}

export function ones(shape: Shape, dtype: DType = "float32"): Tensor {
  const data = newTypedArray(dtype, productOf(shape));
  if (dtype === "int64") (data as BigInt64Array).fill(1n);
  else (data as Float32Array | Int32Array).fill(1);
  return Tensor.contiguous(data, shape, dtype);
}

export function full(shape: Shape, value: number, dtype: DType = "float32"): Tensor {
  const data = newTypedArray(dtype, productOf(shape));
  if (dtype === "int64") (data as BigInt64Array).fill(BigInt(Math.trunc(value)));
  else (data as Float32Array | Int32Array).fill(value);
  return Tensor.contiguous(data, shape, dtype);
}

export function arange(end: number, dtype: DType = "float32"): Tensor {
  const data = newTypedArray(dtype, end);
  for (let i = 0; i < end; i++) {
    if (dtype === "int64") (data as BigInt64Array)[i] = BigInt(i);
    else (data as Float32Array | Int32Array)[i] = i;
  }
  return Tensor.contiguous(data, [end], dtype);
}

export function fromArray(data: number[] | Float32Array, shape: Shape): Tensor {
  if (productOf(shape) !== data.length) {
    throw new Error(
      `fromArray: shape ${JSON.stringify(shape)} (${productOf(shape)} elements) doesn't match data length ${data.length}`,
    );
  }
  const arr = data instanceof Float32Array ? new Float32Array(data) : Float32Array.from(data);
  return Tensor.contiguous(arr, shape, "float32");
}

export function fromIntArray(data: number[] | BigInt64Array, shape: Shape): Tensor {
  const arr = data instanceof BigInt64Array
    ? new BigInt64Array(data)
    : BigInt64Array.from(data, (v) => BigInt(Math.trunc(v)));
  if (productOf(shape) !== arr.length) {
    throw new Error(
      `fromIntArray: shape ${JSON.stringify(shape)} (${productOf(shape)} elements) doesn't match data length ${arr.length}`,
    );
  }
  return Tensor.contiguous(arr, shape, "int64");
}

/** Box-Muller normal sampler with optional seed (deterministic when given). */
export function randn(shape: Shape, seed?: number): Tensor {
  const data = new Float32Array(productOf(shape));
  const sample = seededGaussian(seed);
  for (let i = 0; i < data.length; i++) data[i] = sample();
  return Tensor.contiguous(data, shape, "float32");
}

export function rand(shape: Shape, seed?: number): Tensor {
  const data = new Float32Array(productOf(shape));
  const u = seed === undefined ? Math.random : mulberry32(seed);
  for (let i = 0; i < data.length; i++) data[i] = u();
  return Tensor.contiguous(data, shape, "float32");
}

export function eye(n: number, dtype: DType = "float32"): Tensor {
  const data = newTypedArray(dtype, n * n);
  for (let i = 0; i < n; i++) {
    if (dtype === "int64") (data as BigInt64Array)[i * n + i] = 1n;
    else (data as Float32Array | Int32Array)[i * n + i] = 1;
  }
  return Tensor.contiguous(data, [n, n], dtype);
}

/** Wrap pre-existing typed-array data as a contiguous tensor (no copy). */
export function tensorOf(data: AnyTypedArray, shape: Shape, dtype: DType): Tensor {
  if (data.length !== productOf(shape)) {
    throw new Error(
      `tensorOf: data length ${data.length} != product(shape) ${productOf(shape)}`,
    );
  }
  return new Tensor(data, shape, contiguousStrides(shape), 0, dtype);
}

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 0x12345678;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededGaussian(seed?: number): () => number {
  const u = seed === undefined ? Math.random : mulberry32(seed);
  return () => {
    let a = u();
    while (a <= 0) a = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
  };
}

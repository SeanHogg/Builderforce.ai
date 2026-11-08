import {
  dequantize
} from "./chunk-PAJI6YLR.mjs";

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/dtype.ts
function newTypedArray(dtype, length) {
  switch (dtype) {
    case "float32":
      return new Float32Array(length);
    case "int32":
      return new Int32Array(length);
    case "int64":
      return new BigInt64Array(length);
  }
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/iter.ts
function* iterIndices(shape) {
  const n = shape.length;
  const idx = new Array(n).fill(0);
  if (n === 0 || shape.some((d) => d === 0)) return;
  while (true) {
    yield idx;
    let i = n - 1;
    while (i >= 0) {
      const next = idx[i] + 1;
      if (next < shape[i]) {
        idx[i] = next;
        break;
      }
      idx[i] = 0;
      i--;
    }
    if (i < 0) return;
  }
}
function offsetOf(idx, strides, base) {
  let off = base;
  for (let i = 0; i < idx.length; i++) off += idx[i] * strides[i];
  return off;
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/shape.ts
function productOf(shape) {
  let p = 1;
  for (const d of shape) p *= d;
  return p;
}
function contiguousStrides(shape) {
  const n = shape.length;
  const strides = new Array(n);
  let acc = 1;
  for (let i = n - 1; i >= 0; i--) {
    strides[i] = acc;
    acc *= shape[i];
  }
  return strides;
}
function shapesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function broadcastShape(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const ai = i - (n - a.length);
    const bi = i - (n - b.length);
    const av = ai >= 0 ? a[ai] : 1;
    const bv = bi >= 0 ? b[bi] : 1;
    if (av === bv) out[i] = av;
    else if (av === 1) out[i] = bv;
    else if (bv === 1) out[i] = av;
    else
      throw new Error(
        `broadcastShape: incompatible dim ${av} vs ${bv} at index ${i} (shapes ${JSON.stringify(a)} vs ${JSON.stringify(b)})`
      );
  }
  return out;
}
function broadcastStrides(srcShape, targetShape, srcStrides) {
  const out = new Array(targetShape.length);
  const offset = targetShape.length - srcShape.length;
  if (offset < 0) {
    throw new Error(
      `broadcastStrides: source shape ${JSON.stringify(srcShape)} has more dims than target ${JSON.stringify(targetShape)}`
    );
  }
  for (let i = 0; i < offset; i++) out[i] = 0;
  for (let i = 0; i < srcShape.length; i++) {
    const sv = srcShape[i];
    const tv = targetShape[i + offset];
    if (sv === tv) out[i + offset] = srcStrides[i];
    else if (sv === 1) out[i + offset] = 0;
    else
      throw new Error(
        `broadcastStrides: cannot broadcast dim ${sv} to ${tv} at axis ${i}`
      );
  }
  return out;
}
function normalizeAxis(axis, ndim) {
  const a = axis < 0 ? axis + ndim : axis;
  if (a < 0 || a >= ndim) {
    throw new Error(`normalizeAxis: axis ${axis} out of range for ndim ${ndim}`);
  }
  return a;
}
function normalizeAxes(axes, ndim) {
  return axes.map((a) => normalizeAxis(a, ndim));
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/tensor.ts
var Tensor = class _Tensor {
  constructor(data, shape, strides, offset, dtype) {
    this.data = data;
    this.shape = shape;
    this.strides = strides;
    this.offset = offset;
    this.dtype = dtype;
    if (shape.length !== strides.length) {
      throw new Error(
        `Tensor: shape (${shape.length}D) and strides (${strides.length}D) must match`
      );
    }
  }
  data;
  shape;
  strides;
  offset;
  dtype;
  static contiguous(data, shape, dtype) {
    const expected = productOf(shape);
    if (data.length !== expected) {
      throw new Error(
        `Tensor.contiguous: data length ${data.length} != product(shape)=${expected}`
      );
    }
    return new _Tensor(data, shape, contiguousStrides(shape), 0, dtype);
  }
  get ndim() {
    return this.shape.length;
  }
  get size() {
    return productOf(this.shape);
  }
  isContiguous() {
    if (this.offset !== 0) return false;
    return shapesEqual(this.strides, contiguousStrides(this.shape));
  }
  /** Materialize a fresh row-major buffer. No-op if already contiguous. */
  contiguous() {
    if (this.isContiguous() && this.data.length === this.size) return this;
    return materialize(this);
  }
  /**
   * Read a single element at the given multi-index. Mostly useful for tests
   * and small debug paths — hot loops should iterate strides directly.
   */
  get(...idx) {
    if (idx.length !== this.ndim) {
      throw new Error(`get: expected ${this.ndim} indices, got ${idx.length}`);
    }
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i];
      if (v < 0 || v >= this.shape[i]) {
        throw new Error(`get: index ${v} out of range for dim ${i} (size ${this.shape[i]})`);
      }
    }
    const off = offsetOf(idx, this.strides, this.offset);
    return this.data[off];
  }
  /** Float32 read, throws if dtype isn't float32. */
  getF32(...idx) {
    if (this.dtype !== "float32") throw new Error(`getF32: dtype is ${this.dtype}`);
    return this.get(...idx);
  }
  /** Snapshot to a JS number[] (or nested arrays). Tests + debug only. */
  toArray() {
    if (this.ndim === 0) {
      return Number(this.get());
    }
    return toArrayRec(this, 0, this.offset);
  }
};
function toArrayRec(t, dim, base) {
  const size = t.shape[dim];
  const stride = t.strides[dim];
  const out = new Array(size);
  if (dim === t.ndim - 1) {
    for (let i = 0; i < size; i++) {
      const v = t.data[base + i * stride];
      out[i] = typeof v === "bigint" ? Number(v) : v;
    }
  } else {
    for (let i = 0; i < size; i++) {
      out[i] = toArrayRec(t, dim + 1, base + i * stride);
    }
  }
  return out;
}
function materialize(t) {
  const out = newTypedArray(t.dtype, t.size);
  if (t.ndim === 0) {
    out[0] = t.data[t.offset];
    return new Tensor(out, t.shape, [], 0, t.dtype);
  }
  const cs = contiguousStrides(t.shape);
  for (const idx of iterIndices(t.shape)) {
    const src = offsetOf(idx, t.strides, t.offset);
    const dst = offsetOf(idx, cs, 0);
    out[dst] = t.data[src];
  }
  return new Tensor(out, t.shape, cs, 0, t.dtype);
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/creation.ts
function fromArray(data, shape) {
  if (productOf(shape) !== data.length) {
    throw new Error(
      `fromArray: shape ${JSON.stringify(shape)} (${productOf(shape)} elements) doesn't match data length ${data.length}`
    );
  }
  const arr = data instanceof Float32Array ? new Float32Array(data) : Float32Array.from(data);
  return Tensor.contiguous(arr, shape, "float32");
}
function fromIntArray(data, shape) {
  const arr = data instanceof BigInt64Array ? new BigInt64Array(data) : BigInt64Array.from(data, (v) => BigInt(Math.trunc(v)));
  if (productOf(shape) !== arr.length) {
    throw new Error(
      `fromIntArray: shape ${JSON.stringify(shape)} (${productOf(shape)} elements) doesn't match data length ${arr.length}`
    );
  }
  return Tensor.contiguous(arr, shape, "int64");
}
function tensorOf(data, shape, dtype) {
  if (data.length !== productOf(shape)) {
    throw new Error(
      `tensorOf: data length ${data.length} != product(shape) ${productOf(shape)}`
    );
  }
  return new Tensor(data, shape, contiguousStrides(shape), 0, dtype);
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/ops/elementwise.ts
function binaryF32(a, b, fn, opName) {
  if (a.dtype !== "float32" || b.dtype !== "float32") {
    throw new Error(`${opName}: float32 only (got ${a.dtype} and ${b.dtype})`);
  }
  const outShape = broadcastShape(a.shape, b.shape);
  const outData = new Float32Array(productOf(outShape));
  const aS = broadcastStrides(a.shape, outShape, a.strides);
  const bS = broadcastStrides(b.shape, outShape, b.strides);
  const oS = contiguousStrides(outShape);
  const aData = a.data;
  const bData = b.data;
  if (outShape.length === 0) {
    outData[0] = fn(aData[a.offset], bData[b.offset]);
    return Tensor.contiguous(outData, outShape, "float32");
  }
  for (const idx of iterIndices(outShape)) {
    const ai = offsetOf(idx, aS, a.offset);
    const bi = offsetOf(idx, bS, b.offset);
    const oi = offsetOf(idx, oS, 0);
    outData[oi] = fn(aData[ai], bData[bi]);
  }
  return Tensor.contiguous(outData, outShape, "float32");
}
function unaryF32(a, fn, opName) {
  if (a.dtype !== "float32") throw new Error(`${opName}: float32 only (got ${a.dtype})`);
  const outData = new Float32Array(a.size);
  const oS = contiguousStrides(a.shape);
  const aData = a.data;
  for (const idx of iterIndices(a.shape)) {
    outData[offsetOf(idx, oS, 0)] = fn(aData[offsetOf(idx, a.strides, a.offset)]);
  }
  return Tensor.contiguous(outData, a.shape, "float32");
}
var add = (a, b) => binaryF32(a, b, (x, y) => x + y, "add");
var mul = (a, b) => binaryF32(a, b, (x, y) => x * y, "mul");
function mulScalar(a, s) {
  return unaryF32(a, (x) => x * s, "mulScalar");
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/ops/matmul.ts
function matmul(a, b) {
  if (a.dtype !== "float32" || b.dtype !== "float32") {
    throw new Error(`matmul: float32 only (got ${a.dtype} and ${b.dtype})`);
  }
  if (a.ndim < 2 || b.ndim < 2) {
    throw new Error(`matmul: both inputs must be at least 2D, got ${a.ndim}D and ${b.ndim}D`);
  }
  const M = a.shape[a.ndim - 2];
  const K = a.shape[a.ndim - 1];
  const K2 = b.shape[b.ndim - 2];
  const N = b.shape[b.ndim - 1];
  if (K !== K2) {
    throw new Error(`matmul: inner dim mismatch (a has K=${K}, b has K=${K2})`);
  }
  const aBatch = a.shape.slice(0, -2);
  const bBatch = b.shape.slice(0, -2);
  const batch = broadcastShape(aBatch, bBatch);
  const outShape = [...batch, M, N];
  const outData = new Float32Array(productOf(outShape));
  const aBatchStrides = broadcastStrides(aBatch, batch, a.strides.slice(0, -2));
  const bBatchStrides = broadcastStrides(bBatch, batch, b.strides.slice(0, -2));
  const oBatchStrides = contiguousStrides(batch);
  const aMStride = a.strides[a.ndim - 2];
  const aKStride = a.strides[a.ndim - 1];
  const bKStride = b.strides[b.ndim - 2];
  const bNStride = b.strides[b.ndim - 1];
  const aData = a.data;
  const bData = b.data;
  if (batch.length === 0) {
    matmul2d(outData, 0, aData, a.offset, aMStride, aKStride, bData, b.offset, bKStride, bNStride, M, N, K);
    return Tensor.contiguous(outData, outShape, "float32");
  }
  for (const idx of iterIndices(batch)) {
    const aOff = offsetOf(idx, aBatchStrides, a.offset);
    const bOff = offsetOf(idx, bBatchStrides, b.offset);
    const oOff = offsetOf(idx, oBatchStrides, 0) * M * N;
    matmul2d(outData, oOff, aData, aOff, aMStride, aKStride, bData, bOff, bKStride, bNStride, M, N, K);
  }
  return Tensor.contiguous(outData, outShape, "float32");
}
function matmul2d(out, outOff, a, aOff, aMStride, aKStride, b, bOff, bKStride, bNStride, M, N, K) {
  for (let m = 0; m < M; m++) {
    const aRow = aOff + m * aMStride;
    const oRow = outOff + m * N;
    for (let n = 0; n < N; n++) {
      let acc = 0;
      const bCol = bOff + n * bNStride;
      for (let k = 0; k < K; k++) {
        acc += a[aRow + k * aKStride] * b[bCol + k * bKStride];
      }
      out[oRow + n] = acc;
    }
  }
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/ops/shape.ts
function reshape(t, newShape) {
  const resolved = resolveInferred(newShape, t.size);
  if (productOf(resolved) !== t.size) {
    throw new Error(
      `reshape: new shape ${JSON.stringify(resolved)} (size ${productOf(resolved)}) doesn't match input size ${t.size}`
    );
  }
  if (!t.isContiguous()) {
    return reshape(materialize(t), resolved);
  }
  return new Tensor(t.data, resolved, contiguousStrides(resolved), t.offset, t.dtype);
}
function resolveInferred(shape, totalSize) {
  const inferred = shape.indexOf(-1);
  if (inferred === -1) return [...shape];
  if (shape.lastIndexOf(-1) !== inferred) {
    throw new Error("reshape: at most one dimension may be -1");
  }
  let known = 1;
  for (let i = 0; i < shape.length; i++) if (i !== inferred) known *= shape[i];
  if (known === 0 || totalSize % known !== 0) {
    throw new Error(`reshape: cannot infer dimension for shape ${JSON.stringify(shape)}`);
  }
  const copy = [...shape];
  copy[inferred] = totalSize / known;
  return copy;
}
function transpose(t, axisA, axisB) {
  const a = normalizeAxis(axisA, t.ndim);
  const b = normalizeAxis(axisB, t.ndim);
  if (a === b) return t;
  const shape = [...t.shape];
  const strides = [...t.strides];
  [shape[a], shape[b]] = [shape[b], shape[a]];
  [strides[a], strides[b]] = [strides[b], strides[a]];
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}
function permute(t, axes) {
  if (axes.length !== t.ndim) {
    throw new Error(`permute: got ${axes.length} axes for ${t.ndim}D tensor`);
  }
  const seen = /* @__PURE__ */ new Set();
  const norm = axes.map((a) => normalizeAxis(a, t.ndim));
  for (const a of norm) {
    if (seen.has(a)) throw new Error(`permute: axis ${a} repeated`);
    seen.add(a);
  }
  const shape = norm.map((a) => t.shape[a]);
  const strides = norm.map((a) => t.strides[a]);
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}
function unsqueeze(t, axis) {
  const a = axis < 0 ? axis + t.ndim + 1 : axis;
  if (a < 0 || a > t.ndim) {
    throw new Error(`unsqueeze: axis ${axis} out of range for ${t.ndim}D tensor`);
  }
  const shape = [...t.shape.slice(0, a), 1, ...t.shape.slice(a)];
  const strides = [...t.strides.slice(0, a), 0, ...t.strides.slice(a)];
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}
function expand(t, newShape) {
  if (newShape.length < t.ndim) {
    throw new Error(`expand: target shape ${JSON.stringify(newShape)} has fewer dims than ${t.ndim}D tensor`);
  }
  const offset = newShape.length - t.ndim;
  const shape = [];
  const strides = [];
  for (let i = 0; i < newShape.length; i++) {
    if (i < offset) {
      shape.push(newShape[i]);
      strides.push(0);
    } else {
      const sv = t.shape[i - offset];
      const tv = newShape[i];
      if (sv === tv) {
        shape.push(sv);
        strides.push(t.strides[i - offset]);
      } else if (sv === 1) {
        shape.push(tv);
        strides.push(0);
      } else {
        throw new Error(`expand: cannot broadcast dim ${sv} to ${tv} at axis ${i - offset}`);
      }
    }
  }
  return new Tensor(t.data, shape, strides, t.offset, t.dtype);
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/ops/reduction.ts
function reduceF32(t, axes, keepDims, init, combine, finalize = (a) => a) {
  if (t.dtype !== "float32") throw new Error("reduceF32: float32 only");
  const reduceSet = new Set(normalizeAxes(axes.length === 0 ? t.shape.map((_, i) => i) : axes, t.ndim));
  const outShape = [];
  const keepShape = [];
  for (let i = 0; i < t.ndim; i++) {
    if (reduceSet.has(i)) {
      keepShape.push(1);
      if (keepDims) outShape.push(1);
    } else {
      outShape.push(t.shape[i]);
      keepShape.push(t.shape[i]);
    }
  }
  const outData = new Float32Array(productOf(keepShape));
  outData.fill(init);
  const outStrides = contiguousStrides(keepShape);
  const aData = t.data;
  let reduceCount = 1;
  for (let i = 0; i < t.ndim; i++) if (reduceSet.has(i)) reduceCount *= t.shape[i];
  for (const idx of iterIndices(t.shape)) {
    const src = offsetOf(idx, t.strides, t.offset);
    const projected = idx.map((v, i) => reduceSet.has(i) ? 0 : v);
    const dst = offsetOf(projected, outStrides, 0);
    outData[dst] = combine(outData[dst], aData[src]);
  }
  for (let i = 0; i < outData.length; i++) outData[i] = finalize(outData[i], reduceCount);
  return Tensor.contiguous(outData, outShape, "float32");
}
function mean(t, axes = [], keepDims = false) {
  return reduceF32(t, axes, keepDims, 0, (a, v) => a + v, (acc, n) => acc / n);
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/ops/activation.ts
var silu = (a) => unaryF32(a, (x) => x / (1 + Math.exp(-x)), "silu");
var gelu = (a) => unaryF32(
  a,
  (x) => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x))),
  "gelu"
);
function softmax(t, axis) {
  if (t.dtype !== "float32") throw new Error("softmax: float32 only");
  const ax = normalizeAxis(axis, t.ndim);
  const out = new Float32Array(t.size);
  const oS = contiguousStrides(t.shape);
  const aData = t.data;
  const outerShape = t.shape.map((_, i) => i === ax ? 1 : t.shape[i]);
  const axisSize = t.shape[ax];
  const axisStride = t.strides[ax];
  for (const outer of iterIndices(outerShape)) {
    const baseSrc = offsetOf(outer, t.strides, t.offset);
    const baseDst = offsetOf(outer, oS, 0);
    let m = -Infinity;
    for (let i = 0; i < axisSize; i++) {
      const v = aData[baseSrc + i * axisStride];
      if (v > m) m = v;
    }
    let sum2 = 0;
    const baseDstAx = baseDst;
    const dstStride = oS[ax];
    for (let i = 0; i < axisSize; i++) {
      const e = Math.exp(aData[baseSrc + i * axisStride] - m);
      out[baseDstAx + i * dstStride] = e;
      sum2 += e;
    }
    for (let i = 0; i < axisSize; i++) out[baseDstAx + i * dstStride] /= sum2;
  }
  return Tensor.contiguous(out, t.shape, "float32");
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/nn/linear.ts
var Linear = class {
  constructor(weight, bias = null) {
    this.weight = weight;
    this.bias = bias;
    if (weight.ndim !== 2) {
      throw new Error(`Linear: weight must be 2D [out, in], got ${weight.ndim}D`);
    }
    this.outFeatures = weight.shape[0];
    this.inFeatures = weight.shape[1];
    if (bias && (bias.ndim !== 1 || bias.shape[0] !== this.outFeatures)) {
      throw new Error(
        `Linear: bias must be [${this.outFeatures}], got ${JSON.stringify(bias.shape)}`
      );
    }
  }
  weight;
  bias;
  inFeatures;
  outFeatures;
  forward(x) {
    if (x.shape[x.ndim - 1] !== this.inFeatures) {
      throw new Error(
        `Linear.forward: last dim ${x.shape[x.ndim - 1]} != inFeatures ${this.inFeatures}`
      );
    }
    const wT = transpose(this.weight, 0, 1);
    const y = matmul(x, wT);
    return this.bias ? add(y, this.bias) : y;
  }
};

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/nn/layer-norm.ts
var LayerNorm = class {
  constructor(gamma, beta, eps = 1e-5) {
    this.gamma = gamma;
    this.beta = beta;
    this.eps = eps;
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
  gamma;
  beta;
  eps;
  normalizedShape;
  forward(x) {
    if (x.dtype !== "float32") throw new Error("LayerNorm: float32 only");
    if (x.shape[x.ndim - 1] !== this.normalizedShape) {
      throw new Error(
        `LayerNorm.forward: last dim ${x.shape[x.ndim - 1]} != ${this.normalizedShape}`
      );
    }
    const D = this.normalizedShape;
    const out = new Float32Array(x.size);
    const oS = contiguousStrides(x.shape);
    const xData = x.data;
    const gamma = this.gamma ? this.gamma.contiguous().data : null;
    const beta = this.beta ? this.beta.contiguous().data : null;
    const outerShape = x.shape.slice(0, -1);
    const axisStride = x.strides[x.ndim - 1];
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
};
function normalizeOne(out, dstBase, src, srcBase, srcStride, D, eps, gamma, beta) {
  let mean2 = 0;
  for (let d = 0; d < D; d++) mean2 += src[srcBase + d * srcStride];
  mean2 /= D;
  let variance = 0;
  for (let d = 0; d < D; d++) {
    const c = src[srcBase + d * srcStride] - mean2;
    variance += c * c;
  }
  variance /= D;
  const invStd = 1 / Math.sqrt(variance + eps);
  for (let d = 0; d < D; d++) {
    let v = (src[srcBase + d * srcStride] - mean2) * invStd;
    if (gamma) v *= gamma[d];
    if (beta) v += beta[d];
    out[dstBase + d] = v;
  }
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/nn/rope.ts
function ropeFreqs(seqLen, headDim, base = 1e4) {
  if (headDim % 2 !== 0) throw new Error(`ropeFreqs: headDim must be even, got ${headDim}`);
  const half = headDim / 2;
  const cosData = new Float32Array(seqLen * half);
  const sinData = new Float32Array(seqLen * half);
  for (let s = 0; s < seqLen; s++) {
    for (let d = 0; d < half; d++) {
      const freq = Math.pow(base, -2 * d / headDim);
      const angle = s * freq;
      cosData[s * half + d] = Math.cos(angle);
      sinData[s * half + d] = Math.sin(angle);
    }
  }
  return {
    cos: Tensor.contiguous(cosData, [seqLen, half], "float32"),
    sin: Tensor.contiguous(sinData, [seqLen, half], "float32")
  };
}
function applyRope(x, freqs) {
  if (x.dtype !== "float32") throw new Error("applyRope: float32 only");
  if (x.ndim < 2) throw new Error("applyRope: input must be at least 2D (seq, dim)");
  const headDim = x.shape[x.ndim - 1];
  const seqLen = x.shape[x.ndim - 2];
  if (headDim % 2 !== 0) throw new Error("applyRope: headDim must be even");
  const cos = freqs.cos.contiguous();
  const sin = freqs.sin.contiguous();
  if (cos.shape[0] < seqLen || sin.shape[0] < seqLen) {
    throw new Error(
      `applyRope: rope tables [${cos.shape}] don't cover seqLen ${seqLen}`
    );
  }
  const half = headDim / 2;
  const out = new Float32Array(x.size);
  const xData = x.data;
  const cosData = cos.data;
  const sinData = sin.data;
  const oS = contiguousStrides(x.shape);
  const lastStride = x.strides[x.ndim - 1];
  const seqStride = x.strides[x.ndim - 2];
  const outerShape = x.shape.slice(0, -2);
  const outerIter = outerShape.length === 0 ? [[]] : Array.from(iterIndices(outerShape));
  for (const outer of outerIter) {
    const xOuterOff = offsetOf(outer, x.strides.slice(0, -2), x.offset);
    const oOuterOff = offsetOf(outer, oS.slice(0, -2), 0);
    for (let s = 0; s < seqLen; s++) {
      const cosBase = s * half;
      const sinBase = s * half;
      const xRow = xOuterOff + s * seqStride;
      const oRow = oOuterOff + s * (oS[oS.length - 2] ?? headDim);
      for (let i = 0; i < half; i++) {
        const a = xData[xRow + 2 * i * lastStride];
        const b = xData[xRow + (2 * i + 1) * lastStride];
        const c = cosData[cosBase + i];
        const sn = sinData[sinBase + i];
        out[oRow + 2 * i] = a * c - b * sn;
        out[oRow + 2 * i + 1] = a * sn + b * c;
      }
    }
  }
  return Tensor.contiguous(out, x.shape, "float32");
}

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/nn/timestep.ts
function sinusoidalEmbedding(t, dim, base = 1e4) {
  const half = Math.floor(dim / 2);
  const data = new Float32Array(dim);
  for (let d = 0; d < half; d++) {
    const freq = Math.pow(base, -d / Math.max(1, half));
    data[d] = Math.sin(t * freq);
    data[half + d] = Math.cos(t * freq);
  }
  return Tensor.contiguous(data, [dim], "float32");
}
var TimestepEmbedding = class {
  constructor(proj1, proj2, inDim = 256) {
    this.proj1 = proj1;
    this.proj2 = proj2;
    this.inDim = inDim;
    if (proj1.inFeatures !== inDim) {
      throw new Error(`TimestepEmbedding: proj1 in_features ${proj1.inFeatures} != inDim ${inDim}`);
    }
    if (proj1.outFeatures !== proj2.inFeatures) {
      throw new Error(
        `TimestepEmbedding: proj1.out (${proj1.outFeatures}) != proj2.in (${proj2.inFeatures})`
      );
    }
  }
  proj1;
  proj2;
  inDim;
  forward(t) {
    const sinu = sinusoidalEmbedding(t, this.inDim);
    const x = unsqueeze(sinu, 0);
    const h = silu(this.proj1.forward(x));
    return this.proj2.forward(h);
  }
};

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/nn/multi-head-attention.ts
var MultiHeadAttention = class {
  constructor(qProj, kProj, vProj, outProj, numHeads) {
    this.qProj = qProj;
    this.kProj = kProj;
    this.vProj = vProj;
    this.outProj = outProj;
    this.numHeads = numHeads;
    this.hiddenDim = qProj.outFeatures;
    if (this.hiddenDim % numHeads !== 0) {
      throw new Error(
        `MultiHeadAttention: hidden dim ${this.hiddenDim} not divisible by ${numHeads} heads`
      );
    }
    this.headDim = this.hiddenDim / numHeads;
  }
  qProj;
  kProj;
  vProj;
  outProj;
  numHeads;
  headDim;
  hiddenDim;
  forward(x, rope) {
    if (x.ndim !== 3) {
      throw new Error(`MultiHeadAttention.forward: expected 3D [B, L, D], got ${x.ndim}D`);
    }
    const B = x.shape[0];
    const L = x.shape[1];
    const D = this.hiddenDim;
    const H = this.numHeads;
    const Dh = this.headDim;
    const q4 = permute(reshape(this.qProj.forward(x), [B, L, H, Dh]), [0, 2, 1, 3]);
    const k4 = permute(reshape(this.kProj.forward(x), [B, L, H, Dh]), [0, 2, 1, 3]);
    const v4 = permute(reshape(this.vProj.forward(x), [B, L, H, Dh]), [0, 2, 1, 3]);
    const q = rope ? applyRope(q4.contiguous(), rope) : q4;
    const k = rope ? applyRope(k4.contiguous(), rope) : k4;
    const v = v4;
    const scale = 1 / Math.sqrt(Dh);
    const scores = mulScalar(matmul(q, transpose(k, -2, -1)), scale);
    const probs = softmax(scores, -1);
    const out4 = matmul(probs, v);
    const merged = reshape(permute(out4, [0, 2, 1, 3]).contiguous(), [B, L, D]);
    return this.outProj.forward(merged);
  }
};

// node_modules/.pnpm/@webdit+torch@file+..+webdit+torch/node_modules/@webdit/torch/src/nn/transformer-block.ts
var TransformerBlock = class {
  constructor(norm1, attn, norm2, mlpUp, mlpDown) {
    this.norm1 = norm1;
    this.attn = attn;
    this.norm2 = norm2;
    this.mlpUp = mlpUp;
    this.mlpDown = mlpDown;
  }
  norm1;
  attn;
  norm2;
  mlpUp;
  mlpDown;
  forward(x, condition, rope) {
    if (condition.ndim !== 2) {
      throw new Error(
        `TransformerBlock: condition must be 2D [B, D], got ${condition.ndim}D`
      );
    }
    const condBcast = expand(unsqueeze(condition, 1), x.shape);
    let h = add(x, condBcast);
    h = add(h, this.attn.forward(this.norm1.forward(h), rope));
    h = add(h, this.mlpDown.forward(gelu(this.mlpUp.forward(this.norm2.forward(h)))));
    void mul;
    return h;
  }
};

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/torch-arch/real-mini.ts
var REAL_MINI_CONFIG = {
  latentChannels: 4,
  hiddenDim: 32,
  numHeads: 4,
  numBlocks: 2,
  textDim: 8,
  timestepInDim: 32
};
var RealMiniDit = class {
  constructor(config, inProj, tEmb, textPool, blocks, finalNorm, outProj, ropeMaxLen) {
    this.config = config;
    this.inProj = inProj;
    this.tEmb = tEmb;
    this.textPool = textPool;
    this.blocks = blocks;
    this.finalNorm = finalNorm;
    this.outProj = outProj;
    this.rope = ropeFreqs(ropeMaxLen, config.hiddenDim / config.numHeads);
  }
  config;
  inProj;
  tEmb;
  textPool;
  blocks;
  finalNorm;
  outProj;
  rope;
  forward(latent, timestep, textEmb) {
    if (latent.ndim !== 5) {
      throw new Error(`RealMiniDit: expected 5D latent, got ${latent.ndim}D`);
    }
    const B = latent.shape[0];
    const C = latent.shape[1];
    const T = latent.shape[2];
    const H = latent.shape[3];
    const W = latent.shape[4];
    const seq = T * H * W;
    const flat = permute(reshape(latent.contiguous(), [B, C, seq]), [0, 2, 1]).contiguous();
    let h = this.inProj.forward(flat);
    const tCond = this.tEmb.forward(timestep);
    const textPooled = mean(textEmb, [1]);
    const textCond = this.textPool.forward(textPooled);
    const cond = add(expand(tCond, textCond.shape), textCond);
    for (const block of this.blocks) {
      h = block.forward(h, cond, this.rope);
    }
    h = this.finalNorm.forward(h);
    h = this.outProj.forward(h);
    return reshape(permute(h, [0, 2, 1]).contiguous(), latent.shape);
  }
};
var RealMiniVae = class {
  /** vae.proj : [3, C] — channel projection only (no spatial upsampling in V0). */
  constructor(proj) {
    this.proj = proj;
  }
  proj;
  forward(latent) {
    if (latent.ndim !== 5) {
      throw new Error(`RealMiniVae: expected 5D latent, got ${latent.ndim}D`);
    }
    const B = latent.shape[0];
    const C = latent.shape[1];
    const T = latent.shape[2];
    const H = latent.shape[3];
    const W = latent.shape[4];
    const flat = permute(reshape(latent.contiguous(), [B, C, T * H * W]), [0, 2, 1]).contiguous();
    const projT = permute(this.proj, [1, 0]);
    const projected = matmul(flat, projT);
    const tanhData = new Float32Array(projected.size);
    const src = projected.contiguous().data;
    for (let i = 0; i < src.length; i++) tanhData[i] = Math.tanh(src[i]);
    const squashed = Tensor.contiguous(tanhData, projected.shape, "float32");
    return reshape(permute(squashed, [0, 2, 1]).contiguous(), [B, 3, T, H, W]);
  }
};
var RealMiniTextEncoder = class {
  /** vocab table: [vocab_size, text_dim]. */
  constructor(vocab) {
    this.vocab = vocab;
  }
  vocab;
  forward(inputIds) {
    const L = inputIds.length;
    const D = this.vocab.shape[1];
    const V = this.vocab.shape[0];
    const data = new Float32Array(L * D);
    const w = this.vocab.contiguous().data;
    for (let l = 0; l < L; l++) {
      const id = Number(inputIds[l]) % V;
      const safeId = id < 0 ? id + V : id;
      const src = safeId * D;
      const dst = l * D;
      for (let d = 0; d < D; d++) data[dst + d] = w[src + d];
    }
    return Tensor.contiguous(data, [1, L, D], "float32");
  }
};
function loadRealMini(ditShards, textShards, vaeShards, config = REAL_MINI_CONFIG, ropeMaxLen = 256) {
  const tensorFromShard = (shards, name) => {
    const t = shards.get(name);
    if (!t) {
      throw new Error(
        `loadRealMini: missing weight '${name}' (have: ${Array.from(shards.keys()).join(", ") || "<none>"})`
      );
    }
    return tensorOf(dequantize(t), t.shape, "float32");
  };
  const w = (n) => tensorFromShard(ditShards, n);
  const linearOf = (weightName, biasName) => new Linear(w(weightName), biasName ? w(biasName) : null);
  const layerNormOf = (gammaName, betaName) => new LayerNorm(w(gammaName), w(betaName), 1e-6);
  const tEmb = new TimestepEmbedding(
    linearOf("t_emb.proj1.weight", "t_emb.proj1.bias"),
    linearOf("t_emb.proj2.weight", "t_emb.proj2.bias"),
    config.timestepInDim
  );
  const blocks = [];
  for (let i = 0; i < config.numBlocks; i++) {
    const prefix = `block${i}`;
    const mha = new MultiHeadAttention(
      linearOf(`${prefix}.q.weight`, `${prefix}.q.bias`),
      linearOf(`${prefix}.k.weight`, `${prefix}.k.bias`),
      linearOf(`${prefix}.v.weight`, `${prefix}.v.bias`),
      linearOf(`${prefix}.attn_out.weight`, `${prefix}.attn_out.bias`),
      config.numHeads
    );
    blocks.push(
      new TransformerBlock(
        layerNormOf(`${prefix}.norm1.gamma`, `${prefix}.norm1.beta`),
        mha,
        layerNormOf(`${prefix}.norm2.gamma`, `${prefix}.norm2.beta`),
        linearOf(`${prefix}.mlp_up.weight`, `${prefix}.mlp_up.bias`),
        linearOf(`${prefix}.mlp_down.weight`, `${prefix}.mlp_down.bias`)
      )
    );
  }
  const dit = new RealMiniDit(
    config,
    linearOf("in_proj.weight", "in_proj.bias"),
    tEmb,
    linearOf("text_pool.weight", "text_pool.bias"),
    blocks,
    layerNormOf("final_norm.gamma", "final_norm.beta"),
    linearOf("out_proj.weight", "out_proj.bias"),
    ropeMaxLen
  );
  const textEncoder = new RealMiniTextEncoder(
    tensorFromShard(textShards, "vocab")
  );
  const vae = new RealMiniVae(tensorFromShard(vaeShards, "proj"));
  void fromArray;
  void fromIntArray;
  void unsqueeze;
  return { dit, textEncoder, vae };
}

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/runners-torch.ts
var TorchDitRunner = class {
  constructor(model) {
    this.model = model;
  }
  model;
  async run(latent, t, textEmb) {
    const latentT = tensorOf(latent.data, [...latent.dims], "float32");
    const textT = tensorOf(textEmb.data, [...textEmb.dims], "float32");
    const out = this.model.forward(latentT, t, textT);
    const c = out.contiguous();
    return { data: c.data, dims: c.shape };
  }
};
var TorchTextEncoderRunner = class {
  constructor(model) {
    this.model = model;
  }
  model;
  async run(inputIds, _attentionMask) {
    const out = this.model.forward(inputIds);
    return { data: out.data, dims: out.shape };
  }
};
var TorchVaeRunner = class {
  constructor(model) {
    this.model = model;
  }
  model;
  async run(latent) {
    const latentT = tensorOf(latent.data, [...latent.dims], "float32");
    const out = this.model.forward(latentT);
    return out.contiguous().data;
  }
};
function buildTorchRunners(manifest, ditWeights, textEncoderWeights, vaeWeights) {
  if (manifest.architecture !== "real-mini") {
    throw new Error(
      `buildTorchRunners: only 'real-mini' is supported (got '${manifest.architecture}')`
    );
  }
  const { dit, textEncoder, vae } = loadRealMini(ditWeights, textEncoderWeights, vaeWeights);
  return {
    dit: new TorchDitRunner(dit),
    textEncoder: new TorchTextEncoderRunner(textEncoder),
    vae: new TorchVaeRunner(vae)
  };
}
export {
  TorchDitRunner,
  TorchTextEncoderRunner,
  TorchVaeRunner,
  buildTorchRunners
};
//# sourceMappingURL=runners-torch-SP7DDYM7.mjs.map
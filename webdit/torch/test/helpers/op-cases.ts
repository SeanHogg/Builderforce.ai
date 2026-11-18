import { F, type DeviceTensor } from "../../src/autograd";

/**
 * The op table shared by the CPU gradient checks and the CPU⇄WebGPU parity
 * tests: every differentiable op, with inputs chosen away from kinks and
 * singularities (relu at 0, log/div near 0) so finite differences are valid.
 */

export interface InputSpec {
  shape: number[];
  /** Fixed values; otherwise drawn deterministically in [lo, hi). */
  data?: number[];
  lo?: number;
  hi?: number;
  /** Integer (int32) input — never requires grad. */
  int?: boolean;
  /** Keep |x| at least this far from zero. */
  awayFromZero?: number;
}

export interface OpCase {
  name: string;
  inputs: InputSpec[];
  build: (xs: DeviceTensor[]) => DeviceTensor;
}

export function values(n: number, seed: number, lo = -1, hi = 1, awayFromZero = 0): number[] {
  let s = (seed * 2654435761) >>> 0 || 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    let v = lo + (hi - lo) * (s / 4294967296);
    if (awayFromZero > 0 && Math.abs(v) < awayFromZero) v = v < 0 ? -awayFromZero - Math.abs(v) : awayFromZero + v;
    out.push(v);
  }
  return out;
}

export function materialize(spec: InputSpec, seed: number): number[] {
  if (spec.data) return spec.data;
  const n = spec.shape.reduce((a, b) => a * b, 1);
  return values(n, seed, spec.lo ?? -1, spec.hi ?? 1, spec.awayFromZero ?? 0);
}

const f = (shape: number[], extra: Partial<InputSpec> = {}): InputSpec => ({ shape, ...extra });

export const OP_CASES: OpCase[] = [
  { name: "add (broadcast row)", inputs: [f([2, 3]), f([3])], build: ([a, b]) => F.add(a!, b!) },
  { name: "add (broadcast both)", inputs: [f([2, 1, 3]), f([4, 1])], build: ([a, b]) => F.add(a!, b!) },
  { name: "sub (broadcast col)", inputs: [f([2, 3]), f([2, 1])], build: ([a, b]) => F.sub(a!, b!) },
  { name: "mul (broadcast)", inputs: [f([3, 4]), f([1, 4])], build: ([a, b]) => F.mul(a!, b!) },
  { name: "div (broadcast)", inputs: [f([2, 3]), f([3], { lo: 1, hi: 2 })], build: ([a, b]) => F.div(a!, b!) },
  { name: "affine", inputs: [f([5])], build: ([a]) => F.affine(a!, 2.5, -1) },
  { name: "matmul 2D", inputs: [f([3, 4]), f([4, 2])], build: ([a, b]) => F.matmul(a!, b!) },
  { name: "matmul batched × 2D", inputs: [f([2, 3, 4]), f([4, 5])], build: ([a, b]) => F.matmul(a!, b!) },
  { name: "matmul 2D × batched", inputs: [f([3, 4]), f([2, 4, 5])], build: ([a, b]) => F.matmul(a!, b!) },
  { name: "matmul transA·transB", inputs: [f([4, 3]), f([5, 4])], build: ([a, b]) => F.matmulT(a!, b!, true, true) },
  { name: "matmul transA", inputs: [f([2, 4, 3]), f([2, 4, 5])], build: ([a, b]) => F.matmulT(a!, b!, true, false) },
  { name: "linear (3D input)", inputs: [f([2, 3, 4]), f([5, 4]), f([5])], build: ([x, w, b]) => F.linear(x!, w!, b!) },
  { name: "sum (all)", inputs: [f([2, 3, 4])], build: ([a]) => F.sum(a!) },
  { name: "sum (axis 0)", inputs: [f([2, 3, 4])], build: ([a]) => F.sum(a!, 0) },
  { name: "sum (axes 0,2 keepDims)", inputs: [f([2, 3, 4])], build: ([a]) => F.sum(a!, [0, 2], true) },
  { name: "mean (all)", inputs: [f([3, 4])], build: ([a]) => F.mean(a!) },
  { name: "mean (last, keepDims)", inputs: [f([2, 3, 4])], build: ([a]) => F.mean(a!, -1, true) },
  { name: "relu", inputs: [f([3, 4], { awayFromZero: 0.05 })], build: ([a]) => F.relu(a!) },
  { name: "gelu", inputs: [f([3, 4], { lo: -3, hi: 3 })], build: ([a]) => F.gelu(a!) },
  { name: "gelu (exact erf)", inputs: [f([3, 4], { lo: -3, hi: 3 })], build: ([a]) => F.gelu(a!, "none") },
  { name: "exp", inputs: [f([2, 3])], build: ([a]) => F.exp(a!) },
  { name: "log", inputs: [f([2, 3], { lo: 0.5, hi: 2 })], build: ([a]) => F.log(a!) },
  { name: "softmax", inputs: [f([3, 5], { lo: -2, hi: 2 })], build: ([a]) => F.softmax(a!) },
  { name: "log_softmax (3D)", inputs: [f([2, 3, 4], { lo: -2, hi: 2 })], build: ([a]) => F.logSoftmax(a!) },
  {
    name: "layer_norm (affine)",
    inputs: [f([4, 6], { lo: -2, hi: 2 }), f([6], { lo: 0.5, hi: 1.5 }), f([6])],
    build: ([x, g, b]) => F.layerNorm(x!, g!, b!),
  },
  { name: "layer_norm (no affine)", inputs: [f([3, 5], { lo: -2, hi: 2 })], build: ([x]) => F.layerNorm(x!) },
  {
    name: "embedding (repeated ids)",
    inputs: [f([5, 3]), { shape: [2, 3], data: [0, 4, 2, 2, 0, 1], int: true }],
    build: ([w, ids]) => F.embedding(ids!, w!),
  },
  {
    name: "index_add (repeated ids, untouched rows)",
    inputs: [f([5, 3]), { shape: [5], data: [0, 4, 2, 2, 0], int: true }],
    build: ([src, ids]) => F.indexAdd(ids!, src!, 6),
  },
  {
    name: "gather → index_add round trip",
    inputs: [f([4, 3]), { shape: [3], data: [3, 1, 3], int: true }],
    build: ([x, ids]) => F.indexAdd(ids!, F.mul(F.embedding(ids!, x!), F.embedding(ids!, x!)), 4),
  },
  {
    name: "cross_entropy (mean)",
    inputs: [f([4, 5], { lo: -2, hi: 2 }), { shape: [4], data: [1, 0, 4, 2], int: true }],
    build: ([l, t]) => F.crossEntropy(l!, t!),
  },
  {
    name: "cross_entropy (sum)",
    inputs: [f([3, 4], { lo: -2, hi: 2 }), { shape: [3], data: [3, 3, 0], int: true }],
    build: ([l, t]) => F.crossEntropy(l!, t!, "sum"),
  },
  {
    name: "cross_entropy (none)",
    inputs: [f([3, 4], { lo: -2, hi: 2 }), { shape: [3], data: [2, 1, 0], int: true }],
    build: ([l, t]) => F.crossEntropy(l!, t!, "none"),
  },
  {
    name: "cross_entropy (mean, ignore_index)",
    inputs: [f([5, 4], { lo: -2, hi: 2 }), { shape: [5], data: [1, -100, 3, -100, 0], int: true }],
    build: ([l, t]) => F.crossEntropy(l!, t!),
  },
  {
    name: "cross_entropy (sum, custom ignore_index)",
    inputs: [f([3, 4], { lo: -2, hi: 2 }), { shape: [3], data: [2, 7, 0], int: true }],
    build: ([l, t]) => F.crossEntropy(l!, t!, { reduction: "sum", ignoreIndex: 7 }),
  },
  { name: "reshape (-1)", inputs: [f([2, 6]), f([3, 4])], build: ([a, b]) => F.mul(F.reshape(a!, [3, -1]), b!) },
  { name: "transpose (0, 2)", inputs: [f([2, 3, 4])], build: ([a]) => F.transpose(a!, 0, 2) },
  {
    name: "lora_merge",
    inputs: [f([4, 6]), f([2, 6]), f([4, 2])],
    build: ([base, a, b]) => F.loraMerge(base!, a!, b!, 1.5),
  },
  {
    name: "mlp chain",
    inputs: [f([3, 4]), f([6, 4]), f([6]), f([2, 6]), { shape: [3], data: [1, 0, 1], int: true }],
    build: ([x, w1, b1, w2, t]) => F.crossEntropy(F.linear(F.gelu(F.linear(x!, w1!, b1!)), w2!), t!),
  },
];

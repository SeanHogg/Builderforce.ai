import { UnsupportedOpError } from "../backend/backend";
import { DeviceTensor } from "../autograd/device-tensor";
import { tensor } from "../autograd/creation";
import * as F from "../autograd/functional";
import { carryHostIndices } from "../autograd/index-check";

/**
 * The op table Python dispatches through: `_webdit_torch.op(name, *args)`.
 * Operands arrive as tensor ids (resolved by `T`), scalars as numbers, dims and
 * shapes as JS arrays (`to_js(list)` on the Python side — never a PyProxy),
 * Python `None` as `undefined`. Each entry returns ONE engine tensor; the
 * bridge gives it an id. An unknown name throws `UnsupportedOpError` naming it.
 *
 * Dtypes: the compute kernels are float32 (WebGPU binds every operand as
 * `array<f32>`), so an int32 operand is refused by name — never reinterpreted.
 * Only the layout ops (`reshape`, `transpose`, `detach`, `clone`), `cast`, and
 * the index operands of `embedding` / `cross_entropy` take integers.
 */

export type OpArg = number | string | boolean | undefined | null | ArrayLike<number>;
type Resolve = (arg: OpArg) => DeviceTensor;
/** `T` resolves an operand (float-checked unless the op takes any dtype); `Fl` always float-checks. */
type OpFn = (T: Resolve, args: readonly OpArg[], Fl: Resolve) => DeviceTensor;

const num = (v: OpArg, op: string, what: string): number => {
  if (typeof v !== "number") throw new TypeError(`${op}: ${what} must be a number, got ${typeof v}`);
  return v;
};

const dims = (v: OpArg): number | number[] | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "object") return Array.from(v);
  throw new TypeError(`dim must be an int or a sequence of ints, got ${typeof v}`);
};

const opt = (T: Resolve, v: OpArg): DeviceTensor | null => (v === undefined || v === null ? null : T(v));

/** A 0-d constant on the backend of `like`: the left operand of `scalar / t`. */
const constantLike = (like: DeviceTensor, value: number) => tensor([value], [], { backend: like.backend });

/** Ops whose operands may be any dtype (each checks what it needs itself). */
const ANY_DTYPE = new Set(["reshape", "transpose", "detach", "clone", "cast", "embedding", "cross_entropy"]);

export const OPS: Readonly<Record<string, OpFn>> = {
  add: (T, [a, b]) => F.add(T(a), T(b)),
  sub: (T, [a, b]) => F.sub(T(a), T(b)),
  mul: (T, [a, b]) => F.mul(T(a), T(b)),
  div: (T, [a, b]) => F.div(T(a), T(b)),
  /** a * scale + shift */
  affine: (T, [a, scale, shift]) => F.affine(T(a), num(scale, "affine", "scale"), num(shift ?? 0, "affine", "shift")),
  /** scalar / a */
  rdiv: (T, [s, a]) => {
    const x = T(a);
    return F.div(constantLike(x, num(s, "rdiv", "scalar")), x);
  },
  matmul: (T, [a, b]) => F.matmul(T(a), T(b)),
  linear: (T, [x, w, b]) => F.linear(T(x), T(w), opt(T, b)),
  relu: (T, [x]) => F.relu(T(x)),
  gelu: (T, [x, approximate]) => {
    const mode = approximate ?? "none";
    if (mode !== "none" && mode !== "tanh") throw new UnsupportedOpError("gelu", `approximate=${String(mode)}`);
    return F.gelu(T(x), mode);
  },
  exp: (T, [x]) => F.exp(T(x)),
  log: (T, [x]) => F.log(T(x)),
  softmax: (T, [x, dim]) => F.softmax(T(x), num(dim ?? -1, "softmax", "dim")),
  log_softmax: (T, [x, dim]) => F.logSoftmax(T(x), num(dim ?? -1, "log_softmax", "dim")),
  sum: (T, [x, dim, keep]) => F.sum(T(x), dims(dim), keep === true),
  mean: (T, [x, dim, keep]) => F.mean(T(x), dims(dim), keep === true),
  reshape: (T, [x, shape]) => {
    if (!shape || typeof shape !== "object") throw new TypeError("reshape: shape must be a sequence of ints");
    return F.reshape(T(x), Array.from(shape));
  },
  transpose: (T, [x, d0, d1]) => F.transpose(T(x), num(d0, "transpose", "dim0"), num(d1, "transpose", "dim1")),
  layer_norm: (T, [x, w, b, eps]) => F.layerNorm(T(x), opt(T, w), opt(T, b), num(eps ?? 1e-5, "layer_norm", "eps")),
  embedding: (T, [ids, weight], Fl) => F.embedding(T(ids), Fl(weight)),
  cross_entropy: (T, [logits, targets, reduction, ignoreIndex], Fl) => {
    const r = reduction ?? "mean";
    if (r !== "mean" && r !== "sum" && r !== "none") throw new UnsupportedOpError("cross_entropy", `reduction=${String(r)} is not supported`);
    const x = Fl(logits);
    if (x.ndim !== 2) throw new UnsupportedOpError("cross_entropy", `input must be [N, C] (got ${x.ndim}D); flatten with .view(-1, C)`);
    return F.crossEntropy(x, T(targets), { reduction: r, ignoreIndex: num(ignoreIndex ?? -100, "cross_entropy", "ignore_index") });
  },
  lora_merge: (T, [base, a, b, scale]) => F.loraMerge(T(base), T(a), T(b), num(scale, "lora_merge", "scale")),
  detach: (T, [x]) => T(x).detach(),
  /** A fresh copy: differentiable for float32 (identity grad), a graph-free copy for int32. */
  clone: (T, [x]) => {
    const t = T(x);
    if (t.dtype === "float32") return F.affine(t, 1, 0);
    return carryHostIndices(t, new DeviceTensor(t.backend, t.backend.cast(t.handle, "int32"), false));
  },
  cast: (T, [x, dtype]) => {
    if (dtype !== "float32" && dtype !== "int32") throw new UnsupportedOpError("cast", `to ${String(dtype)}`);
    return F.cast(T(x), dtype);
  },
};

export function runOp(name: string, resolve: Resolve, args: readonly OpArg[]): DeviceTensor {
  const fn = Object.prototype.hasOwnProperty.call(OPS, name) ? OPS[name] : undefined;
  if (!fn) throw new UnsupportedOpError(name, "is not in the @webdit/torch surface");
  const float: Resolve = (arg) => {
    const t = resolve(arg);
    if (t.dtype !== "float32") {
      throw new UnsupportedOpError(name, `needs float32 operands, got ${t.dtype} — cast with .float() first`);
    }
    return t;
  };
  return fn(ANY_DTYPE.has(name) ? resolve : float, args, float);
}

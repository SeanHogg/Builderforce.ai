import type { BackendTensor } from "../backend/backend";
import { contiguousStrides, type Shape } from "../shape";
import { DeviceTensor, type AnyBackend } from "./device-tensor";
import { isGradEnabled } from "./mode";

/**
 * The seam every differentiable op goes through: wrap a backend result, and —
 * when grad mode is on and an input requires grad — attach the grad rule.
 * Plus the two broadcasting helpers every rule shares.
 */

export type GradRule = (gy: BackendTensor, needs: readonly boolean[]) => Array<BackendTensor | null>;

export function backendOf(op: string, ...inputs: DeviceTensor[]): AnyBackend {
  const backend = inputs[0]!.backend;
  for (const t of inputs) {
    if (t.backend !== backend) throw new Error(`${op}: operands live on different backends (${backend.name} vs ${t.backend.name})`);
    if (t.isDisposed) throw new Error(`${op}: operand used after dispose()`);
  }
  return backend;
}

export function record(name: string, out: BackendTensor, inputs: DeviceTensor[], rule: GradRule): DeviceTensor {
  const backend = inputs[0]!.backend;
  const needs = inputs.map((t) => t.requiresGrad);
  const tracked = isGradEnabled() && needs.some(Boolean);
  const result = new DeviceTensor(backend, out, tracked);
  if (tracked) result.gradFn = { name, inputs, backward: (gy) => rule(gy, needs) };
  return result;
}

/** Keep a backend handle alive for a grad rule (released when the graph is dropped). */
export function saved(backend: AnyBackend, handle: BackendTensor): DeviceTensor {
  return new DeviceTensor(backend, handle, false);
}

/**
 * Reduce a broadcast gradient back to `shape`: sum the leading dims the
 * broadcast added and every dim that was 1. Always returns an owned handle.
 */
export function sumTo(backend: AnyBackend, g: BackendTensor, shape: Shape): BackendTensor {
  const lead = g.shape.length - shape.length;
  const axes: number[] = [];
  for (let i = 0; i < lead; i++) axes.push(i);
  for (let i = 0; i < shape.length; i++) {
    if (shape[i] === 1 && g.shape[i + lead] !== 1) axes.push(i + lead);
  }
  if (axes.length === 0) return backend.reshape(g, shape);
  const reduced = backend.sum(g, axes, true);
  const out = backend.reshape(reduced, shape);
  backend.release(reduced);
  return out;
}

/** Broadcast `g` (whose shape is `keepShape` with 1s on reduced dims) back up to `shape`. */
export function expandTo(backend: AnyBackend, g: BackendTensor, keepShape: Shape, shape: Shape): BackendTensor {
  const strides = contiguousStrides(keepShape).map((s, i) => (keepShape[i] === 1 && shape[i] !== 1 ? 0 : s));
  const view = backend.reshape(g, keepShape);
  const out = backend.stridedCopy(view, shape, strides, 0);
  backend.release(view);
  return out;
}

/** Release every temporary handle a rule made along the way. */
export function releaseAll(backend: AnyBackend, ...handles: BackendTensor[]): void {
  for (const h of handles) backend.release(h);
}

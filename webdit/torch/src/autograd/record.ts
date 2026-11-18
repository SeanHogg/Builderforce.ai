import type { BackendTensor } from "../backend/backend";
import { contiguousStrides, type Shape } from "../shape";
import { DeviceTensor, type AnyBackend, type GradNode } from "./device-tensor";
import { isGradEnabled } from "./mode";

/**
 * The seam every differentiable op goes through: wrap a backend result, and —
 * when grad mode is on and an input requires grad — attach the grad rule.
 * Plus the two broadcasting helpers every rule shares.
 *
 * Saved values. A rule that needs forward results (softmax output, layernorm
 * statistics, cross-entropy probabilities) hands their handles to `record` as
 * `saved`. The node owns them: they are released when the graph is freed
 * after backward, when the output is disposed, or — as a last resort — when
 * the node is collected. When nothing is recorded (grad mode off, or no input
 * requires grad) they are released at once, so an inference or `noGrad` step
 * holds no extra memory.
 */

export type GradRule = (gy: BackendTensor, needs: readonly boolean[]) => Array<BackendTensor | null>;

interface SavedState {
  backend: AnyBackend;
  handles: BackendTensor[];
  released: boolean;
}

const savedFinalizer = new FinalizationRegistry<SavedState>((state) => releaseSaved(state));

function releaseSaved(state: SavedState): void {
  if (state.released) return;
  state.released = true;
  for (const h of state.handles) state.backend.release(h);
}

export function freedGraphError(name: string): Error {
  return new Error(
    `${name}: Trying to backward through the graph a second time (or directly access saved tensors after they have already been freed). ` +
      "Saved intermediate values of the graph are freed when you call .backward(). " +
      "Specify retainGraph: true (PyTorch: retain_graph=True) if you need to backward through the graph a second time.",
  );
}

/** What a node becomes once its graph is freed: still not a leaf, and backward through it throws. */
export function freedNode(name: string): GradNode {
  return {
    name,
    inputs: [],
    backward: () => {
      throw freedGraphError(name);
    },
    release: () => undefined,
  };
}

export function backendOf(op: string, ...inputs: DeviceTensor[]): AnyBackend {
  const backend = inputs[0]!.backend;
  for (const t of inputs) {
    if (t.backend !== backend) throw new Error(`${op}: operands live on different backends (${backend.name} vs ${t.backend.name})`);
    if (t.isDisposed) throw new Error(`${op}: operand used after dispose()`);
  }
  return backend;
}

export function record(
  name: string,
  out: BackendTensor,
  inputs: DeviceTensor[],
  rule: GradRule,
  saved: BackendTensor[] = [],
): DeviceTensor {
  const backend = inputs[0]!.backend;
  const needs = inputs.map((t) => t.requiresGrad);
  const tracked = isGradEnabled() && needs.some(Boolean);
  const result = new DeviceTensor(backend, out, tracked);
  const state: SavedState = { backend, handles: saved, released: false };
  if (!tracked) {
    releaseSaved(state);
    return result;
  }
  const node: GradNode = {
    name,
    inputs,
    backward: (gy) => {
      if (state.released) throw freedGraphError(name);
      return rule(gy, needs);
    },
    release: () => {
      savedFinalizer.unregister(node);
      releaseSaved(state);
    },
  };
  if (saved.length > 0) savedFinalizer.register(node, state, node);
  result.gradFn = node;
  return result;
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

import type { BackendTensor } from "../backend/backend";
import { DeviceTensor, type AnyBackend } from "./device-tensor";
import { noGrad } from "./mode";

/**
 * Reverse-mode sweep. Orders the graph topologically from `root`, walks it
 * backwards, accumulates each tensor's incoming gradients, and hands leaf
 * gradients to `.grad`.
 *
 * Ownership: every gradient handle in flight is owned by this sweep and
 * released once consumed. A leaf receives a private COPY, because in-place
 * optimizer kernels (AdamW zeroes its gradient) must never write through to a
 * buffer another leaf's gradient shares.
 */
export function runBackward(root: DeviceTensor, gradient: DeviceTensor | undefined, retainGraph: boolean): void {
  if (!root.requiresGrad) throw new Error("backward: tensor does not require grad and has no grad_fn");
  const backend = root.backend;
  let seed: BackendTensor;
  if (gradient) {
    if (gradient.backend !== backend) throw new Error("backward: gradient lives on a different backend");
    seed = backend.reshape(gradient.handle, root.shape);
  } else {
    if (root.size !== 1) throw new Error(`backward: grad can be implicitly created only for a 1-element output (got ${root.size})`);
    seed = backend.full(root.shape, 1);
  }

  const order = topoOrder(root);
  const pending = new Map<DeviceTensor, BackendTensor>([[root, seed]]);

  noGrad(() => {
    for (let i = order.length - 1; i >= 0; i--) {
      const t = order[i]!;
      const g = pending.get(t);
      if (!g) continue;
      pending.delete(t);
      const node = t.gradFn;
      if (!node) {
        if (t.requiresGrad) accumulateLeaf(backend, t, g);
        backend.release(g);
        continue;
      }
      const inputGrads = node.backward(g);
      backend.release(g);
      node.inputs.forEach((input, k) => {
        const ig = inputGrads[k];
        if (!ig) return;
        if (!input.requiresGrad) {
          backend.release(ig);
          return;
        }
        const prev = pending.get(input);
        if (prev) {
          pending.set(input, backend.binary("add", prev, ig));
          backend.release(prev);
          backend.release(ig);
        } else {
          pending.set(input, ig);
        }
      });
      if (!retainGraph) t.gradFn = null;
    }
  });
  for (const g of pending.values()) backend.release(g);
}

function accumulateLeaf(backend: AnyBackend, leaf: DeviceTensor, g: BackendTensor): void {
  if (leaf.grad) {
    const sum = backend.binary("add", leaf.grad.handle, g);
    leaf.grad.dispose();
    leaf.grad = new DeviceTensor(backend, sum, false);
  } else {
    leaf.grad = new DeviceTensor(backend, backend.affine(g, 1, 0), false);
  }
}

/** Inputs before consumers; iterative so deep graphs cannot overflow the stack. */
function topoOrder(root: DeviceTensor): DeviceTensor[] {
  const order: DeviceTensor[] = [];
  const visited = new Set<DeviceTensor>();
  const stack: Array<{ t: DeviceTensor; expanded: boolean }> = [{ t: root, expanded: false }];
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.expanded) {
      order.push(top.t);
      continue;
    }
    if (visited.has(top.t)) continue;
    visited.add(top.t);
    stack.push({ t: top.t, expanded: true });
    for (const input of top.t.gradFn?.inputs ?? []) {
      if (!visited.has(input) && input.requiresGrad) stack.push({ t: input, expanded: false });
    }
  }
  return order;
}

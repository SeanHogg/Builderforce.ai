import type { BackendTensor } from "../backend/backend";
import { DeviceTensor, type AnyBackend } from "./device-tensor";
import { noGrad } from "./mode";
import { freedNode } from "./record";
import { keep } from "./scope";

/**
 * Reverse-mode sweep. Orders the graph topologically from `root`, walks it
 * backwards, accumulates each tensor's incoming gradients, and adds leaf
 * gradients into `.grad` IN PLACE (the `.grad` object a caller holds stays the
 * same object, as in PyTorch).
 *
 * Ownership: every gradient handle in flight is owned by this sweep and
 * released once consumed. A leaf's first gradient is a private COPY, because
 * later accumulation (and any in-place optimizer) writes into `.grad` and must
 * never write through to a buffer another leaf's gradient shares. `.grad`
 * tensors belong to no `tidy` scope — they live as long as their parameter.
 *
 * Graph freeing (retainGraph false): each visited node releases its saved
 * values and is replaced by a freed sentinel, so the tensor is still not a
 * leaf and a second backward through it throws (PyTorch's "backward through
 * the graph a second time") instead of silently stopping there.
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

  try {
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
        let inputGrads: Array<BackendTensor | null>;
        try {
          inputGrads = node.backward(g);
        } finally {
          backend.release(g);
        }
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
        if (!retainGraph) {
          node.release();
          t.gradFn = freedNode(node.name);
        }
      }
    });
  } finally {
    for (const g of pending.values()) backend.release(g);
  }
}

function accumulateLeaf(backend: AnyBackend, leaf: DeviceTensor, g: BackendTensor): void {
  if (leaf.grad && !leaf.grad.isDisposed) {
    backend.addInPlace(leaf.grad.handle, g);
  } else {
    leaf.grad = keep(new DeviceTensor(backend, backend.affine(g, 1, 0), false));
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

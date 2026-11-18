import type { DeviceTensor } from "../autograd/device-tensor";
import { isGradEnabled } from "../autograd/mode";
import { HostScope } from "../autograd/scope";

/**
 * The tensor ids Python holds, and the collector that frees what Python no
 * longer reaches. Python never holds an engine object: every Python `Tensor`
 * owns ONE integer id, created by the op that returned it and released by the
 * wrapper's `__del__`. No PyProxy is ever created (JS never holds a Python
 * object) and no JsProxy is held per tensor, so nothing crosses the FFI that
 * either side must remember to destroy.
 *
 * LIFETIME RULE. Every tensor a bridge call creates — including the
 * intermediates the engine makes inside an op — joins ONE `HostScope` the
 * bridge enters around each call (`run`); tensors the rest of the worker
 * creates never join it. `collect()` prunes it: a tensor survives when an id
 * Python holds names it, or when it is reachable through the recorded graph
 * (`gradFn.inputs`) of such a tensor — so a graph is never cut under a pending
 * `backward()`. Everything else is disposed (GPU buffers back to the pool).
 * Collection is always safe, so the bridge runs it at the natural step
 * boundaries (after `backward`, `optimizer.step`, `zero_grad`, leaving
 * `no_grad`) and also whenever the scope's tensor count or bytes have doubled
 * since the last collection (plus a slack), which bounds a loop that never
 * hits a boundary. Under `no_grad`, a tensor whose last id is released and
 * that no live graph references is freed at once.
 *
 * Gradients (`.grad`) and optimizer state are owned by their parameter /
 * optimizer, outside the scope, exactly as in the engine. A `.grad` Python
 * still references when its owner drops it (`zero_grad`, or the owner being
 * collected) is detached and adopted by the scope, so it lives until Python
 * lets go.
 */
export class HandleTable {
  private nextId = 1;
  private readonly byId = new Map<number, DeviceTensor>();
  private readonly pins = new Map<DeviceTensor, number>();
  private readonly scope = new HostScope();
  private countAtLastCollect = 0;
  private bytesAtLastCollect = 0;

  /**
   * @param countSlack scope growth (tensors) beyond twice the last post-collection count that triggers a collection.
   * @param byteSlack the same in bytes.
   */
  constructor(
    private readonly countSlack = 256,
    private readonly byteSlack = 64 * 1024 * 1024,
  ) {}

  /**
   * Run one bridge call inside the scope. Under no_grad nothing a call creates
   * can be recorded by a graph, so whatever it made that ended up without an id
   * (an op's internal intermediates) is freed as the call returns.
   */
  run<T>(fn: () => T): T {
    if (isGradEnabled()) return this.scope.run(fn);
    return this.scope.run(fn, (t) => this.pins.has(t));
  }

  /** A new id for `t` (one per Python wrapper). May collect garbage created earlier. */
  put(t: DeviceTensor): number {
    const id = this.nextId++;
    this.byId.set(id, t);
    this.pins.set(t, (this.pins.get(t) ?? 0) + 1);
    if (
      this.scope.size > 2 * this.countAtLastCollect + this.countSlack ||
      this.scope.bytes > 2 * this.bytesAtLastCollect + this.byteSlack
    ) {
      this.collect();
    }
    return id;
  }

  get(id: number): DeviceTensor {
    const t = this.byId.get(id);
    if (!t) throw new Error(`torch bridge: tensor id ${id} is not live (released, or never created)`);
    if (t.isDisposed) throw new Error(`torch bridge: tensor id ${id} was disposed (its owner — a parameter, or zero_grad — freed it)`);
    return t;
  }

  /** Python dropped the wrapper. The tensor is freed at once under no_grad when nothing needs it, else by the next collection. */
  release(id: number): void {
    const t = this.byId.get(id);
    if (!t) return;
    this.byId.delete(id);
    const left = (this.pins.get(t) ?? 1) - 1;
    if (left > 0) {
      this.pins.set(t, left);
      return;
    }
    this.pins.delete(t);
    if (!isGradEnabled() && t.gradFn === null && this.scope.has(t) && !this.referencedByGraph(t)) {
      this.rescueGrad(t);
      this.scope.discard(t);
    }
  }

  isPinned(t: DeviceTensor): boolean {
    return this.pins.has(t);
  }

  /** Hand a tensor nobody owns any more (a dropped `.grad`) to the scope, so the collector frees it once unreferenced. */
  adopt(t: DeviceTensor): void {
    this.scope.adopt(t);
  }

  /** Whether `t` is an input of a recorded graph some pinned tensor still holds (in-place writes would corrupt it). */
  referencedByGraph(t: DeviceTensor): boolean {
    const seen = new Set<DeviceTensor>();
    const stack: DeviceTensor[] = [];
    for (const p of this.pins.keys()) if (p.gradFn && p.gradFn.inputs.length > 0) stack.push(p);
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const input of n.gradFn?.inputs ?? []) {
        if (input === t) return true;
        if (!seen.has(input)) stack.push(input);
      }
    }
    return false;
  }

  /** Dispose every scope tensor neither Python nor a referenced graph reaches. Returns how many were freed. */
  collect(): number {
    const live = new Set<DeviceTensor>();
    const stack = [...this.pins.keys()];
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (live.has(t)) continue;
      live.add(t);
      for (const input of t.gradFn?.inputs ?? []) if (!live.has(input)) stack.push(input);
    }
    const freed = this.scope.prune(
      (t) => live.has(t),
      (t) => this.rescueGrad(t),
    );
    this.countAtLastCollect = this.scope.size;
    this.bytesAtLastCollect = this.scope.bytes;
    return freed;
  }

  /** `t` is about to be disposed: a `.grad` Python still holds is detached from it and adopted, not disposed with it. */
  rescueGrad(t: DeviceTensor): void {
    const g = t.grad;
    if (g && !g.isDisposed && this.pins.has(g)) {
      t.grad = null;
      this.scope.adopt(g);
    }
  }

  stats(): { ids: number; pinned: number; scoped: number; scopedBytes: number } {
    return { ids: this.byId.size, pinned: this.pins.size, scoped: this.scope.size, scopedBytes: this.scope.bytes };
  }
}

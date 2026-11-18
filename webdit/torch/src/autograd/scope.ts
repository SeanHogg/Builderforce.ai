import { DeviceTensor } from "./device-tensor";

/**
 * Deterministic tensor lifetimes. JavaScript frees GPU storage only when the
 * collector runs a finalizer, which a tight synchronous training loop never
 * yields for — so every step's activations would pile up in VRAM. A scope
 * records every tensor created inside it and disposes them all at its end,
 * except the ones it returns (or `keep`s), which move to the enclosing scope.
 *
 *   const loss = tidy(() => { const l = F.crossEntropy(model.forward(x), y); l.backward(); opt.step(); return l; });
 *
 * Run backward INSIDE the scope that built the graph: a kept tensor's graph can
 * still reference tensors the scope disposed. Parameters, their `.grad`, and
 * optimizer state are never scope-owned.
 *
 * `tidy` is synchronous. A host whose step spans awaits brackets it with
 * `startScope()` / `endScope(kept)` itself; one whose step is many separate
 * calls (the Pyodide bridge) re-enters a `HostScope` around each call.
 */

const scopes: Array<Set<DeviceTensor>> = [];

/** Called by the DeviceTensor constructor. */
export function trackInScope(t: DeviceTensor): void {
  scopes[scopes.length - 1]?.add(t);
}

/** Take `t` out of every scope: it outlives them all (a parameter, a `.grad`). */
export function keep<T extends DeviceTensor>(t: T): T {
  for (const scope of scopes) scope.delete(t);
  return t;
}

export function startScope(): void {
  scopes.push(new Set());
}

/** Dispose every tensor of the innermost scope except `kept`, which move to the enclosing scope. */
export function endScope(kept: Iterable<DeviceTensor> = []): void {
  const scope = scopes.pop();
  if (!scope) throw new Error("endScope: no open scope");
  const survivors = new Set(kept);
  const parent = scopes[scopes.length - 1];
  for (const t of scope) {
    if (survivors.has(t)) parent?.add(t);
    else t.dispose();
  }
}

/**
 * A scope that outlives any one call. A host whose "step" is not one JS call
 * (the Pyodide bridge: a Python loop calls in op by op) enters it around each
 * synchronous call with `run`, so exactly the tensors made inside those calls
 * join it — tensors the rest of the realm makes never do. Members are disposed
 * only by `prune`, never by leaving `run`.
 */
export class HostScope {
  private readonly members = new MemberSet();

  /**
   * With `retainFresh`, the members that JOIN during this call and that it
   * rejects are disposed as the call ends — for a host that knows nothing
   * created in the call can be referenced afterwards except what it retains
   * (the bridge under no_grad: no graph records them, so an intermediate an op
   * made internally is garbage the moment the op returns).
   */
  run<T>(fn: () => T, retainFresh?: (t: DeviceTensor) => boolean): T {
    const depth = scopes.length;
    scopes.push(this.members);
    const fresh = retainFresh && !this.members.fresh ? (this.members.fresh = new Set()) : null;
    let completed = false;
    try {
      const result = fn();
      completed = true;
      return result;
    } finally {
      const balanced = scopes.length === depth + 1 && scopes[depth] === this.members;
      scopes.length = depth; // restore the stack either way
      if (fresh) {
        this.members.fresh = null;
        for (const t of fresh) if (this.members.has(t) && !retainFresh!(t)) this.discard(t);
      }
      // Only a call that RETURNED reports imbalance; a throwing call keeps its own error.
      if (completed && !balanced) throw new Error("HostScope.run: the scope stack was left unbalanced inside the call");
    }
  }

  /** Make `t` a member (a tensor its owner gave up, e.g. a dropped `.grad`). */
  adopt(t: DeviceTensor): void {
    this.members.add(t);
  }

  has(t: DeviceTensor): boolean {
    return this.members.has(t);
  }

  /** Dispose one member now; false when `t` is not a member. */
  discard(t: DeviceTensor): boolean {
    if (!this.members.delete(t)) return false;
    t.dispose();
    return true;
  }

  /**
   * Dispose every member `retain` rejects; returns how many were disposed.
   * `beforeDispose` sees each one first (to rescue state it owns, e.g. a `.grad` still referenced).
   */
  prune(retain: (t: DeviceTensor) => boolean, beforeDispose?: (t: DeviceTensor) => void): number {
    let disposed = 0;
    for (const t of [...this.members]) {
      if (retain(t)) continue;
      beforeDispose?.(t);
      this.members.delete(t);
      t.dispose();
      disposed++;
    }
    return disposed;
  }

  get size(): number {
    return this.members.size;
  }

  /** Bytes the members' values occupy (4 per element). */
  get bytes(): number {
    return this.members.bytes;
  }
}

/** A Set that keeps the byte total of its tensors as they join and leave (the engine's `trackInScope` adds through it). */
class MemberSet extends Set<DeviceTensor> {
  bytes = 0;
  /** While a `run(fn, retainFresh)` is open: the members that joined during it. */
  fresh: Set<DeviceTensor> | null = null;

  override add(t: DeviceTensor): this {
    if (!this.has(t)) {
      this.bytes += t.size * 4;
      this.fresh?.add(t);
    }
    return super.add(t);
  }

  override delete(t: DeviceTensor): boolean {
    const had = super.delete(t);
    if (had) this.bytes -= t.size * 4;
    return had;
  }
}

export function tidy<T>(fn: () => T): T {
  startScope();
  let result: T;
  try {
    result = fn();
  } catch (error) {
    endScope();
    throw error;
  }
  if (result instanceof Promise) {
    endScope();
    throw new Error("tidy: the function returned a Promise — use startScope()/endScope() around async work");
  }
  endScope(tensorsIn(result));
  return result;
}

/** The tensors a scope's result holds: itself, or the members of an array / plain object. */
function tensorsIn(value: unknown): DeviceTensor[] {
  if (value instanceof DeviceTensor) return [value];
  if (Array.isArray(value)) return value.filter((v): v is DeviceTensor => v instanceof DeviceTensor);
  if (value && typeof value === "object") {
    return Object.values(value).filter((v): v is DeviceTensor => v instanceof DeviceTensor);
  }
  return [];
}

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
 * `tidy` is synchronous. A host whose step spans awaits (the Pyodide handle
 * driver) brackets it with `startScope()` / `endScope(kept)` itself.
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

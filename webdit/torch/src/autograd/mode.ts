/**
 * Grad mode — the `torch.no_grad()` switch. While disabled, ops record no
 * graph and their results never require grad.
 *
 * `noGrad(fn)` scopes a synchronous block. A host whose block spans awaits
 * (Python's `with torch.no_grad():` over an asyncio loop) holds the switch
 * itself with `setGradEnabled`, restoring the value it returned.
 */

let enabled = true;

export function isGradEnabled(): boolean {
  return enabled;
}

/** Set grad mode; returns the previous value so the caller can restore it. */
export function setGradEnabled(value: boolean): boolean {
  const previous = enabled;
  enabled = value;
  return previous;
}

export function noGrad<T>(fn: () => T): T {
  const previous = setGradEnabled(false);
  try {
    return fn();
  } finally {
    setGradEnabled(previous);
  }
}

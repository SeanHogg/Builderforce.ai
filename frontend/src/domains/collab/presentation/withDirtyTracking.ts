import type { BlockDocument } from './useBlockDocument';

/** The only functions on a `BlockDocument` that do NOT change its content. */
const NON_MUTATING: ReadonlySet<string> = new Set(['setFocusedBlock']);

/**
 * "This client edited the document since the last autosave" — the flag `withDirtyTracking`'s
 * `markDirty` usually sets. Not React state (setting it must not re-render) and not a ref
 * (it is handed to the wrapper during render): create it once, e.g. `useState(createDirtyFlag)`,
 * and read it only from effects and handlers.
 */
export function createDirtyFlag(): { mark: () => void; clear: () => void; isSet: () => boolean } {
  let dirty = false;
  return {
    mark: () => { dirty = true; },
    clear: () => { dirty = false; },
    isSet: () => dirty,
  };
}

/**
 * A `BlockDocument` whose every mutating operation first calls `markDirty`.
 *
 * Wraps EVERY function on the document except the explicit non-mutating ones, so a
 * newly added operation (the drawing-block stroke ops were once missed here, and a
 * stroke-only edit never autosaved) is tracked without anyone remembering to list it.
 * Changes that arrive from a peer never pass through this wrapper, which is the point.
 */
export function withDirtyTracking(doc: BlockDocument, markDirty: () => void): BlockDocument {
  const wrapped: Record<string, unknown> = { ...doc };
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value !== 'function' || NON_MUTATING.has(key)) continue;
    wrapped[key] = (...args: unknown[]) => {
      markDirty();
      return (value as (...inner: unknown[]) => unknown)(...args);
    };
  }
  return wrapped as unknown as BlockDocument;
}

import type { Ref, RefCallback } from 'react';

/**
 * Combine several refs into one callback ref. A node that two independent concerns each
 * need their own handle to — a `useChromeSpace` measurement and a drag offset, say — can
 * only carry one `ref` prop, so the callers merge here instead of one of them reaching
 * into the other's hook for a node it was never given.
 */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined | null>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else (ref as { current: T | null }).current = node;
    }
  };
}

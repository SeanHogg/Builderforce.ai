/**
 * `compute()` in the same render when the work is small, on an idle callback when it is big (`defer`). Nothing is
 * scheduled for small work, so a small graph paints complete on its first frame. `fallback` is as in `useIdleSteps`
 * (keep the old value until the new one lands; what a failed computation settles on).
 */

import { useMemo } from 'react';
import { useIdleSteps } from './useIdleSteps';

export function useDeferredWhen<T>(compute: () => T, deps: readonly unknown[], defer: boolean, fallback?: T): T | null {
    const now = useMemo(() => (defer ? null : compute()), [defer, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
    const later = useIdleSteps<T>(() => ({ step: () => true, result: compute }), deps, fallback, defer);
    return defer ? later : now;
}

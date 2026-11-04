/**
 * A value computed OFF the render path: on `requestIdleCallback` (else `setTimeout(0)`), so a
 * layout over thousands of nodes never blocks the first paint. Null until the first result;
 * the previous value stays while the next one computes. Shared by the 2D and 3D renderers.
 */

import { useEffect, useState } from 'react';

export function useIdleValue<T>(compute: () => T, deps: readonly unknown[]): T | null {
    const [value, setValue] = useState<T | null>(null);
    useEffect(() => {
        let live = true;
        const run = () => { if (live) setValue(compute()); };
        const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
        if (idle) idle(run); else setTimeout(run, 0);
        return () => { live = false; };
        // `compute` closes over `deps`; callers list exactly what it reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return value;
}

/**
 * A value computed OFF the render path: on `requestIdleCallback` (else `setTimeout(0)`), so a
 * layout over thousands of nodes never blocks the first paint. Null until the first result.
 * Shared by the 2D and 3D renderers.
 *
 * When `deps` change the old value is cleared (it answers a question nobody asks any more), unless a
 * `fallback` is given: then the old value stays until the new one lands, and `fallback` is what a failed
 * computation settles on (logged with `console.error`), so the value is never null forever.
 */

import { useEffect, useState } from 'react';
import { scheduleIdle } from './idle';

export function useIdleValue<T>(compute: () => T, deps: readonly unknown[], fallback?: T): T | null {
    const [value, setValue] = useState<T | null>(null);
    useEffect(() => {
        let live = true;
        if (fallback === undefined) setValue(null);
        const cancel = scheduleIdle(() => {
            if (!live) return;
            try {
                setValue(compute());
            } catch (error) {
                console.error('useIdleValue: the computation failed', error);
                if (fallback !== undefined) setValue(fallback);
            }
        });
        return () => { live = false; cancel(); };
        // `compute` closes over `deps`; callers list exactly what it reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return value;
}

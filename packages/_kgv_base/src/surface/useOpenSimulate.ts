/**
 * "Simulate this" from a card or a code lens: opens the drawer's Simulate tab with the journey stepped to the stop asked for. The stop is a station id; the
 * asker may have just switched the line (so the path under `surface` is the OLD one when it calls), so the step is set once the new path is the one on show.
 * A stop that is on neither the path it was asked on nor the next one is dropped: a later, unrelated path change never jumps the step.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PathModel } from './path';
import type { SurfaceModel } from './useSurface';

export function useOpenSimulate(surface: Pick<SurfaceModel, 'path' | 'setStep'>, setPanel: (id: string | null) => void): (stopId?: string) => void {
    const [pending, setPending] = useState<{ stopId: string; askedOn: PathModel } | null>(null);
    const { path, setStep } = surface;
    useEffect(() => {
        if (pending === null) return;
        const at = path.stops.findIndex((s) => s.id === pending.stopId);
        if (at >= 0) { setStep(at); setPending(null); return; }
        // The path it was asked on lacks it: wait for the line switch. Any other path lacking it: give up.
        if (path !== pending.askedOn) setPending(null);
    }, [pending, path, setStep]);
    return useCallback((stop?: string) => {
        setPending(stop ? { stopId: stop, askedOn: path } : null);
        setPanel('simulate');
    }, [setPanel, path]);
}

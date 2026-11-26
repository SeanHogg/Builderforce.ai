/**
 * "Simulate this" from a card or a code lens: opens the drawer's Simulate tab with the journey stepped to the stop asked for. The stop is a station id; the
 * asker may have just switched the line (so the path under `surface` is the OLD one when it calls), so the step is set once the new path is the one on show.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SurfaceModel } from './useSurface';

export function useOpenSimulate(surface: Pick<SurfaceModel, 'path' | 'setStep'>, setPanel: (id: string | null) => void): (stopId?: string) => void {
    const [stopId, setStopId] = useState<string | null>(null);
    const { path, setStep } = surface;
    useEffect(() => {
        if (stopId === null) return;
        const at = path.stops.findIndex((s) => s.id === stopId);
        if (at >= 0) { setStep(at); setStopId(null); }
    }, [stopId, path, setStep]);
    return useCallback((stop?: string) => {
        setStopId(stop ?? null);
        setPanel('simulate');
    }, [setPanel]);
}

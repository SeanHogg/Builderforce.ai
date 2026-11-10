/**
 * The stage's rig, wired (PRD 43 B2): ONE {@link RigController} per stage that
 *
 * - re-homes (fits, tweened with the marks; the first placement and reduced motion jump) only when the CAMERA or the
 *   placement's BOUNDS change — an unfold patch, a channel change or a symbol load is a new placement object of the same
 *   camera and extent, and the person's pan and zoom stay where they are;
 * - re-fits on a resize only while the person has not moved the view;
 * - registers +, −, Fit through `usePanZoomRegistration`, so the overlay's buttons and `ScaleLine` work for the stage as
 *   for every camera;
 * - binds the gestures of the placement's frame.
 *
 * `placement` null (none yet, or one built for another MarkSet generation): nothing is fitted.
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { usePanZoomRegistration } from '../../surface/zoom';
import { fitView } from '../projection';
import { now, TWEEN_MS } from '../tween';
import type { CameraRig, Placement } from '../types';
import { bindGestures } from './gestures';
import { RigController } from './rig';

/** What a re-home is keyed by: the camera (the cache key's camera field) and the placement's extent. */
export function homeKeyOf(p: Pick<Placement, 'cacheKey' | 'bounds' | 'rig'>): string {
    const camera = p.cacheKey.split('|')[1] ?? '';
    return `${camera}|${p.rig.frame}|${p.bounds.min.join(',')}|${p.bounds.max.join(',')}`;
}

export function useRig(placement: Placement | null, width: number, height: number, reducedMotion: boolean, box: RefObject<HTMLElement | null>, onSettle: () => void): RigController {
    const rig = useMemo(() => new RigController(), []);
    const homed = useRef<string | null>(null);
    const settle = useRef(onSettle);
    settle.current = onSettle;
    const frame = useRef<CameraRig['frame']>(placement?.rig.frame ?? 'fill');
    frame.current = placement?.rig.frame ?? frame.current;

    useEffect(() => {
        if (!placement) return;
        const home = fitView(placement.bounds, width, height);
        const key = homeKeyOf(placement);
        if (homed.current === key) { rig.resize(home, width, height); return; }
        const first = homed.current === null;
        homed.current = key;
        rig.setHome(home, placement.rig, width, height, now(), first || reducedMotion ? 0 : TWEEN_MS);
    }, [rig, placement, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

    usePanZoomRegistration({
        zoomBy: (factor: number) => { rig.zoomBy(factor); settle.current(); },
        reset: () => { rig.fit(now(), reducedMotion ? 0 : TWEEN_MS); settle.current(); },
    });

    useEffect(() => {
        const el = box.current;
        if (!el) return undefined;
        return bindGestures(el, rig, () => frame.current, () => settle.current());
    }, [rig, box]);

    return rig;
}

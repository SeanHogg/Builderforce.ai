/**
 * The 3D / Flat switch on the stage (PRD 43 C4), the controlled `flat` prop applied to the rig. Switching animates:
 *
 * - an ORBIT placement (the 3D camera): the rig tweens its pitch to straight down (Flat) or back to the placement's
 *   (3D); in Flat a drag turns the view only (`RigController.orbitBy`);
 * - a GROUND placement: the depth (tilt = extrude, B1a rule 7) eases to 0 (Flat, drag stays pan) or up to the tilt the host
 *   asked for (`tilt`, the Map's towers) / `RESTING_DEPTH` (3D). This is the ONE driver of the depth on a switch: the
 *   stage has no second tilt effect when `flat` is controlled.
 *
 * Reduced motion jumps. The depth goes through the stage's `setDepth` (rig + the renderer's uniform on every step, the
 * label pass and overlay once it settles), so the animation is the same path a drag used to take.
 */

import { useEffect, useRef } from 'react';
import { RESTING_DEPTH } from '../depth';
import { now, TWEEN_MS } from '../tween';
import type { RigController } from './rig';

export interface FlatTiltInput {
    rig: RigController;
    /** Controlled: Flat (true) or 3D (false). Absent ⇒ the switch is not driving the stage. */
    flat: boolean | undefined;
    /** A placement for the current MarkSet exists. */
    ready: boolean;
    reducedMotion: boolean;
    /** The tilt 3D eases to when the host asks for one (the Map's towers: 1); absent ⇒ the resting tilt, or a deeper one already there. */
    tilt?: number | undefined;
    setDepth(depth: number): void;
    /** A frame is needed (the orbit tween). */
    invalidate(): void;
}

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function useFlatTilt({ rig, flat, ready, reducedMotion, tilt, setDepth, invalidate }: FlatTiltInput): void {
    const apply = useRef(setDepth);
    apply.current = setDepth;
    const asked = useRef(tilt);
    asked.current = tilt;
    const frame = useRef<number | null>(null);
    const stopAnimation = (): void => {
        if (frame.current !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame.current);
        frame.current = null;
    };
    useEffect(() => stopAnimation, []);
    useEffect(() => {
        if (flat === undefined || !ready) return;
        stopAnimation();
        const ms = reducedMotion ? 0 : TWEEN_MS;
        rig.setFlat(flat, now(), ms); // the orbit's pitch; a ground view only records it
        invalidate();
        if (rig.orbiting) return;
        const want = asked.current;
        const to = flat ? 0 : want !== undefined && want > 0 ? want : Math.max(rig.depth, RESTING_DEPTH);
        const from = rig.depth;
        if (to === from) return;
        if (ms <= 0 || typeof requestAnimationFrame === 'undefined') { apply.current(to); return; }
        const start = now();
        const step = (): void => {
            const t = Math.min(1, (now() - start) / ms);
            apply.current(from + (to - from) * ease(t));
            frame.current = t < 1 ? requestAnimationFrame(step) : null;
        };
        frame.current = requestAnimationFrame(step);
    }, [flat, ready, rig.orbiting]); // eslint-disable-line react-hooks/exhaustive-deps
}

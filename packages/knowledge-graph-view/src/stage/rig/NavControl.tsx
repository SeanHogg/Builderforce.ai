/**
 * The stage's navigation control (PRD 43 B2), bottom-right of every stage camera: a pan pad (on 3D, up / down travel
 * through the plane stack: `rig.slideBy`), the orbit buttons while the rig orbits (rotate left / right, tilt up / down:
 * `rig.orbitBy`, the same step as the canvas's arrow keys), and +, −, Fit through the SAME `panZoomOf` actions the
 * overlay's buttons call. Real <button>s with localized names; press-and-hold repeats. Colours are theme tokens only.
 */

import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { SceneLabels } from '../../labels/surface.scene';
import { cssVar } from '../../scene/themeColors';
import type { PanZoom } from '../../surface/zoom';
import { ZOOM_STEP } from '../../surface/zoom';
import { ORBIT_DEG_PER_PX, ORBIT_KEY_DEG, type RigController } from './rig';

export interface NavLabels { nav: SceneLabels['nav']; zoomIn: string; zoomOut: string; zoomReset: string }

export interface NavControlProps {
    rig: RigController;
    panZoom: PanZoom;
    labels: NavLabels;
    /** The view stopped moving (screen labels re-place). */
    onSettle(): void;
}

/** CSS px one pad press moves the view; the orbit step is the arrow keys'. */
export const NAV_PAN_PX = 48;
const ORBIT_STEP_PX = ORBIT_KEY_DEG / ORBIT_DEG_PER_PX;
const HOLD_DELAY_MS = 350, HOLD_EVERY_MS = 60;

const BUTTON: CSSProperties = {
    width: 40, height: 40, padding: 0, borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 16, lineHeight: 1,
    border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text'), touchAction: 'none',
};
const ROW: CSSProperties = { display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' };

/** One button: a pointer press acts at once and repeats while held; Enter / Space (a click with no pointer) acts once. */
function NavButton({ label, glyph, act, onSettle }: { label: string; glyph: string; act(): void; onSettle(): void }) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const stop = () => {
        if (!timer.current) return;
        clearTimeout(timer.current);
        clearInterval(timer.current);
        timer.current = null;
        onSettle();
    };
    useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
    const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        act();
        timer.current = setTimeout(() => { timer.current = setInterval(act, HOLD_EVERY_MS); }, HOLD_DELAY_MS);
    };
    return (
        <button
            type="button" aria-label={label} title={label} style={BUTTON} data-nav={label}
            onPointerDown={down} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
            onClick={(e) => { if (e.detail === 0) { act(); onSettle(); } }}
        >
            <span aria-hidden="true">{glyph}</span>
        </button>
    );
}

export function NavControl({ rig, panZoom, labels, onSettle }: NavControlProps) {
    const orbiting = useSyncExternalStore((fn) => rig.subscribe(fn), () => rig.orbiting, () => false);
    const n = labels.nav;
    const b = (label: string, glyph: string, act: () => void) => <NavButton key={label} label={label} glyph={glyph} act={act} onSettle={onSettle} />;
    // Each button names where the VIEW goes: "Move down" shows what is below (the content slides up).
    return (
        <div role="group" aria-label={n.group} data-stage-nav style={{ display: 'grid', gap: 4, justifyItems: 'end', pointerEvents: 'auto' }}>
            {orbiting && (
                <div style={ROW} data-stage-nav-orbit>
                    {b(n.rotateLeft, '⟲', () => rig.orbitBy(-ORBIT_STEP_PX, 0))}
                    {b(n.tiltUp, '⤒', () => rig.orbitBy(0, ORBIT_STEP_PX))}
                    {b(n.tiltDown, '⤓', () => rig.orbitBy(0, -ORBIT_STEP_PX))}
                    {b(n.rotateRight, '⟳', () => rig.orbitBy(ORBIT_STEP_PX, 0))}
                </div>
            )}
            <div style={ROW}>
                {b(n.panLeft, '←', () => rig.slideBy(NAV_PAN_PX, 0))}
                {b(n.panUp, '↑', () => rig.slideBy(0, NAV_PAN_PX))}
                {b(n.panDown, '↓', () => rig.slideBy(0, -NAV_PAN_PX))}
                {b(n.panRight, '→', () => rig.slideBy(-NAV_PAN_PX, 0))}
            </div>
            <div style={ROW}>
                {b(labels.zoomIn, '+', () => rig.zoomBy(ZOOM_STEP))}
                {b(labels.zoomOut, '−', () => rig.zoomBy(1 / ZOOM_STEP))}
                <button type="button" aria-label={labels.zoomReset} title={labels.zoomReset} style={BUTTON} data-nav={labels.zoomReset} onClick={() => panZoom.reset()}>
                    <span aria-hidden="true">⤢</span>
                </button>
            </div>
        </div>
    );
}

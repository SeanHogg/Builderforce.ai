/**
 * The stage's camera column (the design's `#nav`), bottom-right of every stage camera: a vertical box of 28px ghost icon
 * buttons — rotate left, rotate right, tilt up, tilt down (the orbit buttons: `rig.orbitBy`, the arrow keys' step), zoom in,
 * zoom out, look from above (pitched to the placement's steepest tilt), reset the camera (the SAME `panZoomOf` Fit the
 * overlay calls) and help (the controls, as a tooltip). Rotate / tilt / top show only while the rig orbits; tilt and top
 * are hidden in Flat. Real <button>s with localized names; press-and-hold repeats. Colours are theme tokens only.
 */

import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { SceneLabels } from '../../labels/surface.scene';
import { cssVar } from '../../scene/themeColors';
import type { PanZoom } from '../../surface/zoom';
import { ZOOM_STEP } from '../../surface/zoom';
import { Glyph } from '../../surface/ui/glyphs';
import { ORBIT_DEG_PER_PX, ORBIT_KEY_DEG, type RigController } from './rig';

export interface NavLabels { nav: SceneLabels['nav']; zoomIn: string; zoomOut: string; zoomReset: string }

export interface NavControlProps {
    rig: RigController;
    panZoom: PanZoom;
    labels: NavLabels;
    /** The view stopped moving (screen labels re-place). */
    onSettle(): void;
}

const ORBIT_STEP_PX = ORBIT_KEY_DEG / ORBIT_DEG_PER_PX;
const HOLD_DELAY_MS = 350, HOLD_EVERY_MS = 60;

const BUTTON: CSSProperties = {
    width: 28, height: 28, padding: 0, borderRadius: 4, cursor: 'pointer', font: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid transparent', background: 'transparent', color: cssVar('text'), touchAction: 'none',
};

/** One button: a pointer press acts at once and repeats while held; Enter / Space (a click with no pointer) acts once. */
function NavButton({ label, icon, act, onSettle, repeat = true }: { label: string; icon: ReactNode; act(): void; onSettle(): void; repeat?: boolean }) {
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
        if (e.button !== 0 || !repeat) return;
        act();
        timer.current = setTimeout(() => { timer.current = setInterval(act, HOLD_EVERY_MS); }, HOLD_DELAY_MS);
    };
    return (
        <button
            type="button" aria-label={label} title={label} style={BUTTON} data-nav={label}
            onPointerDown={down} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
            onClick={(e) => { if (e.detail === 0 || !repeat) { act(); onSettle(); } }}
        >
            {icon}
        </button>
    );
}

const ICON = {
    rotl: <Glyph><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5v3h3" /></Glyph>,
    rotr: <Glyph><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" /></Glyph>,
    tiltu: <Glyph><path d="M8 13V3M4.5 6.5 8 3l3.5 3.5M3 13.5h10" /></Glyph>,
    tiltd: <Glyph><path d="M8 3v10M4.5 9.5 8 13l3.5-3.5M3 2.5h10" /></Glyph>,
    zin: <Glyph><circle cx="7" cy="7" r="4.5" /><path d="M10.3 10.3 14 14M5 7h4M7 5v4" /></Glyph>,
    zout: <Glyph><circle cx="7" cy="7" r="4.5" /><path d="M10.3 10.3 14 14M5 7h4" /></Glyph>,
    top: <Glyph><rect x="3" y="3" width="10" height="10" /><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" /></Glyph>,
    home: <Glyph><path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5" /></Glyph>,
    help: <Glyph><circle cx="8" cy="8" r="5.5" /><path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4" /><circle cx="8" cy="11.5" r=".75" fill="currentColor" stroke="none" /></Glyph>,
};

export function NavControl({ rig, panZoom, labels, onSettle }: NavControlProps) {
    const orbiting = useSyncExternalStore((fn) => rig.subscribe(fn), () => rig.orbiting, () => false);
    const flat = useSyncExternalStore((fn) => rig.subscribe(fn), () => rig.flat, () => false);
    const n = labels.nav;
    const b = (label: string, icon: ReactNode, act: () => void, repeat?: boolean) => <NavButton key={label} label={label} icon={icon} act={act} onSettle={onSettle} repeat={repeat} />;
    return (
        <div role="group" aria-label={n.group} data-stage-nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 3, border: `1px solid ${cssVar('border')}`, borderRadius: 6, background: cssVar('panel'), pointerEvents: 'auto' }}>
            {orbiting && (
                <>
                    <span data-stage-nav-orbit style={{ display: 'contents' }}>
                        {b(n.rotateLeft, ICON.rotl, () => rig.orbitBy(-ORBIT_STEP_PX, 0))}
                        {b(n.rotateRight, ICON.rotr, () => rig.orbitBy(ORBIT_STEP_PX, 0))}
                        {!flat && b(n.tiltUp, ICON.tiltu, () => rig.orbitBy(0, ORBIT_STEP_PX))}
                        {!flat && b(n.tiltDown, ICON.tiltd, () => rig.orbitBy(0, -ORBIT_STEP_PX))}
                    </span>
                </>
            )}
            {b(labels.zoomIn, ICON.zin, () => rig.zoomBy(ZOOM_STEP))}
            {b(labels.zoomOut, ICON.zout, () => rig.zoomBy(1 / ZOOM_STEP))}
            {orbiting && !flat && b(n.top, ICON.top, () => rig.orbitBy(0, TOP_PX), false)}
            {b(labels.zoomReset, ICON.home, () => panZoom.reset(), false)}
            <button type="button" aria-label={n.help} title={n.helpText} style={{ ...BUTTON, color: cssVar('muted') }} data-nav-help>{ICON.help}</button>
        </div>
    );
}

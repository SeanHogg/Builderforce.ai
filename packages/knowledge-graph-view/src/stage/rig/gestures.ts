/**
 * The stage's gestures (PRD 43 B2), bound to the stage's box:
 *
 * - `fill` frames: the wheel zooms about the pointer; one finger or a mouse drag pans; a pinch zooms.
 * - `document` frames (sized to content, the page scrolls): the plain wheel is NOT captured — the page scrolls as
 *   before — and zoom comes from +/−/Fit or Ctrl/⌘ + wheel (a trackpad pinch); a mouse drag pans, one finger scrolls
 *   the page (`touch-action: pan-x pan-y`), a pinch zooms.
 * - On a `fill` frame Shift + wheel or a trackpad scroll pans instead ({@link wheelIntent}); in 3D it moves through the stack.
 * - Tilt is never a gesture: the depth control owns it, so it never collides with pinch or page scroll.
 *
 * A drag starts only past a few px, so a click still reaches the mark (proxy) under it, and the click that ends a drag
 * is swallowed. `onSettle` fires once the view stops moving (pointer up, or wheel quiet), when screen labels re-place.
 */

import type { CameraRig } from '../types';
import { ORBIT_DEG_PER_PX, ORBIT_KEY_DEG, type RigController } from './rig';

const DRAG_SLOP = 4;
const WHEEL_SETTLE_MS = 150;
const WHEEL_ZOOM = 0.0015;

/**
 * Arrow keys orbit an orbit view — only while the CANVAS itself has focus (`e.target === canvas`), so they never
 * collide with the a11y proxies' roving arrows. Returns the unbind.
 */
export function bindOrbitKeys(canvas: HTMLElement, rig: RigController, onSettle: () => void): () => void {
    const STEP = ORBIT_KEY_DEG / ORBIT_DEG_PER_PX;
    const keydown = (e: KeyboardEvent) => {
        if (e.target !== canvas || !rig.orbiting) return;
        const d = ({ ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] } as Record<string, [number, number]>)[e.key];
        if (!d) return;
        e.preventDefault();
        rig.orbitBy(d[0], d[1]);
        onSettle();
    };
    canvas.addEventListener('keydown', keydown);
    return () => canvas.removeEventListener('keydown', keydown);
}

/** What a wheel event does: the page scrolls, the view zooms (dollies in orbit), or the view slides (pans). */
export type WheelIntent = 'page' | 'zoom' | 'pan';

/**
 * A `document` frame leaves the plain wheel to the page (only Ctrl/⌘ + wheel — a trackpad pinch — zooms). A `fill`
 * frame: Ctrl/⌘ zooms; Shift + wheel, or a trackpad's two-finger scroll (pixel deltas with a sideways part or a
 * fractional step), pans — through a 3D stack, up and down; a plain mouse wheel zooms. Pure.
 */
export function wheelIntent(e: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'deltaMode' | 'deltaX' | 'deltaY'>, frame: CameraRig['frame']): WheelIntent {
    if (e.ctrlKey || e.metaKey) return 'zoom';
    if (frame !== 'fill') return 'page';
    if (e.shiftKey) return 'pan';
    const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY));
    return trackpad ? 'pan' : 'zoom';
}

export const touchActionFor =(frame: CameraRig['frame']): string => (frame === 'fill' ? 'none' : 'pan-x pan-y');

export function bindGestures(el: HTMLElement, rig: RigController, frame: () => CameraRig['frame'], onSettle: () => void): () => void {
    const pointers = new Map<number, { x: number; y: number; type: string }>();
    let dragging = false, swallowClick = false, pinchDist = 0, wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const local = (e: { clientX: number; clientY: number }): [number, number] => {
        const r = el.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    };
    const spread = (): number => {
        const [a, b] = [...pointers.values()];
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };

    const down = (e: PointerEvent) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
        if (pointers.size === 2) pinchDist = spread();
        dragging = false;
    };
    const move = (e: PointerEvent) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (pointers.size >= 2) {
            p.x = e.clientX; p.y = e.clientY;
            const d = spread();
            if (pinchDist > 0 && d > 0) {
                let mx = 0, my = 0;
                for (const q of pointers.values()) { mx += q.x / pointers.size; my += q.y / pointers.size; }
                const [sx, sy] = local({ clientX: mx, clientY: my });
                rig.zoomBy(d / pinchDist, sx, sy);
            }
            pinchDist = d;
            dragging = true;
            return;
        }
        // One finger on a document frame scrolls the page; the browser owns it.
        if (p.type === 'touch' && frame() === 'document') return;
        if (!dragging && Math.hypot(dx, dy) < DRAG_SLOP) return;
        if (!dragging) { dragging = true; el.setPointerCapture?.(e.pointerId); }
        p.x = e.clientX; p.y = e.clientY;
        rig.panBy(dx, dy);
    };
    const up = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
        if (dragging && pointers.size === 0) { swallowClick = true; dragging = false; onSettle(); }
    };
    const click = (e: MouseEvent) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
    };
    const wheel = (e: WheelEvent) => {
        // A document frame leaves the plain wheel to the page; Ctrl/⌘ + wheel (and a trackpad pinch, which the browser
        // sends as one) zooms it like a map, so the semantic zoom (B1a rule 9) reaches every band there too.
        const intent = wheelIntent(e, frame());
        if (intent === 'page') return;
        e.preventDefault();
        if (intent === 'pan') {
            // Shift + wheel: some systems turn the vertical wheel into deltaX; either way it is the slide's y.
            const dy = e.shiftKey && e.deltaY === 0 ? e.deltaX : e.deltaY, dx = e.shiftKey ? 0 : e.deltaX;
            rig.slideBy(-dx, -dy);
        } else {
            const [sx, sy] = local(e);
            rig.zoomBy(Math.exp(-e.deltaY * WHEEL_ZOOM), sx, sy);
        }
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { wheelTimer = null; onSettle(); }, WHEEL_SETTLE_MS);
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
        if (wheelTimer) clearTimeout(wheelTimer);
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.removeEventListener('click', click, true);
        el.removeEventListener('wheel', wheel);
    };
}

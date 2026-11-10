/**
 * The stage's gestures (PRD 43 B2), bound to the stage's box:
 *
 * - `fill` frames: the wheel zooms about the pointer; one finger or a mouse drag pans; a pinch zooms.
 * - `document` frames (sized to content, the page scrolls): the wheel is NOT captured — the page scrolls as before —
 *   and zoom comes from +/−/Fit; a mouse drag pans, one finger scrolls the page (`touch-action: pan-x pan-y`), a pinch
 *   zooms.
 * - Tilt is never a gesture: the depth control owns it, so it never collides with pinch or page scroll.
 *
 * A drag starts only past a few px, so a click still reaches the mark (proxy) under it, and the click that ends a drag
 * is swallowed. `onSettle` fires once the view stops moving (pointer up, or wheel quiet), when screen labels re-place.
 */

import type { CameraRig } from '../types';
import type { RigController } from './rig';

const DRAG_SLOP = 4;
const WHEEL_SETTLE_MS = 150;
const WHEEL_ZOOM = 0.0015;

export const touchActionFor = (frame: CameraRig['frame']): string => (frame === 'fill' ? 'none' : 'pan-x pan-y');

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
        if (frame() !== 'fill') return;
        e.preventDefault();
        const [sx, sy] = local(e);
        rig.zoomBy(Math.exp(-e.deltaY * WHEEL_ZOOM), sx, sy);
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

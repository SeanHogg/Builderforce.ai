/**
 * Pan and zoom for an SVG, in VIEWBOX terms. Wheel and pinch zoom about the pointer (scale
 * capped 0.2..8 of the fitted view); a drag pans. Pointer capture starts only once a drag
 * passes a few pixels, so a plain click still reaches the node under it; `wasDrag()` lets
 * the node ignore the click that ends a drag. Shared by the 2D graph and the mind map.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export interface ViewBox { x: number; y: number; w: number; h: number }

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 8;
const DRAG_SLOP = 4;

/** `view` zoomed by `factor` about the fractional point (fx, fy) of itself, scale kept within the cap relative to `base`. */
export function zoomedView(view: ViewBox, base: ViewBox, factor: number, fx = 0.5, fy = 0.5): ViewBox {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (base.w / view.w) * factor));
    const w = base.w / scale, h = base.h / scale;
    return { x: view.x + (view.w - w) * fx, y: view.y + (view.h - h) * fy, w, h };
}

export interface PanZoom {
    svgRef: RefObject<SVGSVGElement | null>;
    view: ViewBox | null;
    viewBox: string | undefined;
    bind: {
        onPointerDown(e: ReactPointerEvent<SVGSVGElement>): void;
        onPointerMove(e: ReactPointerEvent<SVGSVGElement>): void;
        onPointerUp(e: ReactPointerEvent<SVGSVGElement>): void;
        onPointerCancel(e: ReactPointerEvent<SVGSVGElement>): void;
    };
    wasDrag(): boolean;
    /** A pointer position in SVG units, plus one CSS pixel in those units; null before the SVG has a size. */
    toPoint(clientX: number, clientY: number): { x: number; y: number; unit: number } | null;
    zoomBy(factor: number): void;
    reset(): void;
    /** Recentres on (x, y) only when it lies outside the current view. */
    reveal(x: number, y: number): void;
}

/**
 * `fitKey` names the thing being fitted (a layout): a new key re-fits and forgets the person's pan and zoom.
 * A new `base` under the SAME key (a container resize) re-fits only while the person has not moved the view.
 * A drag moves the viewBox attribute directly and commits state on pointer-up, so panning never re-renders the graph.
 */
export function usePanZoom(base: ViewBox | null, fitKey: unknown): PanZoom {
    const svgRef = useRef<SVGSVGElement>(null);
    const [view, setView] = useState<ViewBox | null>(base);
    const viewRef = useRef<ViewBox | null>(base);
    const baseRef = useRef(base);
    baseRef.current = base;
    const moved = useRef(false);
    const lastKey = useRef(fitKey);

    const commit = useCallback((v: ViewBox | null) => { viewRef.current = v; setView(v); }, []);
    useEffect(() => {
        if (lastKey.current !== fitKey) { lastKey.current = fitKey; moved.current = false; }
        if (!moved.current) commit(base);
    }, [base, fitKey, commit]);

    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef({ moved: 0, dragging: false, pinch: 0 });
    const dragged = useRef(false);

    const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
        const b = baseRef.current, v = viewRef.current;
        if (!b || !v) return;
        const r = svgRef.current?.getBoundingClientRect();
        const at = clientX !== undefined && clientY !== undefined && r && r.width > 0 && r.height > 0
            ? [(clientX - r.left) / r.width, (clientY - r.top) / r.height] as const
            : [0.5, 0.5] as const;
        moved.current = true;
        commit(zoomedView(v, b, factor, at[0], at[1]));
    }, [commit]);

    const attached = view !== null;
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return undefined;
        // Non-passive on purpose: the wheel must not scroll the page behind the graph.
        const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [zoomAt, attached]);

    const wasDrag = useCallback(() => dragged.current, []);
    const release = (e: ReactPointerEvent<SVGSVGElement>) => {
        pointers.current.delete(e.pointerId);
        // The click that ends a drag fires before this timer; a key press after it must not be taken for one.
        setTimeout(() => { dragged.current = false; }, 0);
        gesture.current.pinch = 0;
        if (gesture.current.dragging && pointers.current.size === 0) { gesture.current.dragging = false; setView(viewRef.current); }
    };
    const bind: PanZoom['bind'] = {
        onPointerDown: (e) => {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            gesture.current = { moved: 0, dragging: false, pinch: 0 };
            dragged.current = false;
        },
        onPointerMove: (e) => {
            const last = pointers.current.get(e.pointerId);
            if (!last) return;
            const now = { x: e.clientX, y: e.clientY };
            pointers.current.set(e.pointerId, now);
            const g = gesture.current;
            if (pointers.current.size >= 2) {
                const [a, b] = [...pointers.current.values()];
                const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
                if (g.pinch > 0 && d > 0) zoomAt(d / g.pinch, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
                g.pinch = d;
                dragged.current = true;
                return;
            }
            g.moved += Math.abs(now.x - last.x) + Math.abs(now.y - last.y);
            if (!g.dragging && g.moved > DRAG_SLOP) {
                g.dragging = true;
                dragged.current = true;
                moved.current = true;
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
            }
            const v = viewRef.current;
            const r = svgRef.current?.getBoundingClientRect();
            if (!g.dragging || !v || !r || r.width <= 0 || r.height <= 0) return;
            const next = { ...v, x: v.x - ((now.x - last.x) * v.w) / r.width, y: v.y - ((now.y - last.y) * v.h) / r.height };
            viewRef.current = next;
            svgRef.current?.setAttribute('viewBox', `${next.x} ${next.y} ${next.w} ${next.h}`);
        },
        onPointerUp: release,
        onPointerCancel: release,
    };

    return {
        svgRef, view, bind,
        viewBox: view ? `${view.x} ${view.y} ${view.w} ${view.h}` : undefined,
        wasDrag,
        toPoint: (clientX, clientY) => {
            const v = viewRef.current, r = svgRef.current?.getBoundingClientRect();
            if (!v || !r || r.width <= 0 || r.height <= 0) return null;
            const unit = Math.max(v.w / r.width, v.h / r.height); // preserveAspectRatio "meet"
            return { x: v.x + v.w / 2 + (clientX - (r.left + r.width / 2)) * unit, y: v.y + v.h / 2 + (clientY - (r.top + r.height / 2)) * unit, unit };
        },
        zoomBy: (factor) => zoomAt(factor),
        reset: () => { moved.current = false; commit(baseRef.current); },
        reveal: (x, y) => {
            const v = viewRef.current;
            if (v && (x < v.x || x > v.x + v.w || y < v.y || y > v.y + v.h)) { moved.current = true; commit({ ...v, x: x - v.w / 2, y: y - v.h / 2 }); }
        },
    };
}

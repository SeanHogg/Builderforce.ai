/**
 * The stage component's state hooks (PRD 43 B3, B7), kept out of `Stage.tsx` so it stays the composition:
 *
 * - {@link useStageRenderer}: create AND dispose the renderer in ONE effect (Strict Mode mounts twice; a memoized
 *   renderer disposed by the first cleanup would be dead on the second mount);
 * - {@link useLiveKeys}: the renderer's live slot keys (MarkSet + appended), re-read when they change;
 * - {@link useTweening}: true for a tween's length after a placement change (picking and proxies are off meanwhile);
 * - {@link useStageMotion}: decorative motion only while on screen, the page visible, and motion allowed;
 * - {@link useDepth}: the depth control — the uniform on every drag tick, the label pass and overlay once it settles.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { StageBus } from './anchor/stageBus';
import type { StageRenderer } from './renderer';
import type { RigController } from './rig/rig';
import { TWEEN_MS } from './tween';
import type { Placement } from './types';

/**
 * Null until the effect has run; `false` when the factory declined (no WebGL: the host falls back to the List).
 */
export function useStageRenderer(create: () => StageRenderer | null): StageRenderer | null | false {
    const [renderer, setRenderer] = useState<StageRenderer | null | false>(null);
    const make = useRef(create);
    make.current = create;
    useEffect(() => {
        const r = make.current();
        if (!r) { setRenderer(false); return undefined; }
        setRenderer(r);
        return () => { r.dispose(); setRenderer((cur) => (cur === r ? null : cur)); };
    }, []);
    return renderer;
}

export function useLiveKeys(renderer: StageRenderer): readonly string[] {
    return useSyncExternalStore((cb) => renderer.onKeys(cb), () => renderer.keys(), () => renderer.keys());
}

export function useTweening(placement: Placement | null, reducedMotion: boolean): boolean {
    const [state, setState] = useState<{ of: Placement | null; on: boolean }>({ of: placement, on: false });
    if (state.of !== placement) setState({ of: placement, on: !reducedMotion && state.of !== null && placement !== null });
    useEffect(() => {
        if (!state.on) return undefined;
        const id = setTimeout(() => setState((s) => (s.of === placement ? { ...s, on: false } : s)), TWEEN_MS);
        return () => clearTimeout(id);
    }, [state.on, placement]);
    return state.on;
}

export function useStageMotion(renderer: StageRenderer, box: RefObject<HTMLElement | null>, reduced: boolean, bus: StageBus): void {
    useEffect(() => {
        let onScreen = true;
        const apply = () => { renderer.setMotion({ visible: onScreen && (typeof document === 'undefined' || document.visibilityState !== 'hidden'), reduced }); bus.invalidate(); };
        apply();
        const el = box.current;
        const io = el && typeof IntersectionObserver !== 'undefined'
            ? new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting); apply(); })
            : null;
        if (el) io?.observe(el);
        document.addEventListener('visibilitychange', apply);
        return () => { io?.disconnect(); document.removeEventListener('visibilitychange', apply); };
    }, [renderer, box, reduced, bus]);
}

/** Quiet time after the last depth tick before the label pass and the overlay follow it. */
export const DEPTH_SETTLE_MS = 150;

export function useDepth(renderer: StageRenderer, rig: RigController, bus: StageBus): { depth: number; setDepth(d: number): void } {
    const [depth, setState] = useState(rig.depth);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const setDepth = (d: number) => {
        rig.setDepth(d);
        const v = rig.depth;
        setState(v);
        renderer.setDepth(v, false); // the uniform only, while the drag runs
        bus.invalidate();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; renderer.setDepth(v, true); bus.settle(); bus.invalidate(); }, DEPTH_SETTLE_MS);
    };
    return { depth, setDepth };
}

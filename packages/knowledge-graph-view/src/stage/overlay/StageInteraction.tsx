/**
 * The stage's interaction layer (PRD 43 B5, B7 Selection), the DOM side over the ONE canvas. It picks on the main thread
 * (hover and select never wait on the worker) and drives the overlay — the selection ring with the selection's best
 * incident edges sliced from the ranked index, the hover ring and the path highlight — as overlay meshes, never as a
 * mark rebuild. The a11y proxies mount here.
 *
 * Pointer events are read on the stage's own box (they bubble up from the canvas), so the rig's gestures on the canvas
 * keep working; a press that did not move is a click and selects what is under it. Picking is off during a tween.
 * The stage keeps the bus's placement, projection and tween state; this gives the bus the renderer as its source (depth,
 * the MarkSet's importance tie-break, the live keys) and settles once on mount, so the proxies exist before the first
 * camera settle. Hover and selection rings hide during a tween (the renderer's overlay follows only a landed placement).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { StageRenderer } from '../renderer';
import { StageProxies } from '../StageProxies';
import type { Placement } from '../types';
import type { StageBus } from '../anchor/stageBus';
import { INCIDENT_SHOWN } from './incident';
import type { OverlayState } from './OverlayLayer';

export interface StageInteractionProps {
    bus: StageBus;
    renderer: StageRenderer;
    keys: readonly string[];
    placement: Placement;
    tweening: boolean;
    selected: string | null;
    description?: string | undefined;
    onSelect(key: string): void;
    onOut?: (() => void) | undefined;
}

/** A press that moved more than this is a drag (the rig's), not a click. */
const CLICK_SLOP_PX = 4;

/** Re-renders when the camera owner changes the bus's options (incident index, path, line picks). */
function useBusOptions(bus: StageBus): StageBus['options'] {
    const [options, setOptions] = useState(bus.options);
    useEffect(() => { setOptions(bus.options); return bus.onOptions(() => setOptions(bus.options)); }, [bus]);
    return options;
}

export function StageInteraction({ bus, renderer, keys, placement, tweening, selected, description, onSelect, onOut }: StageInteractionProps) {
    const options = useBusOptions(bus);
    const own = useRef<HTMLDivElement>(null);
    const select = useRef(onSelect);
    select.current = onSelect;

    // The bus reads the renderer at a settle: the depth (towers at their drawn height), the MarkSet's importance (the
    // tie-break `nearestHit` uses) and the live keys (appended slots included).
    useLayoutEffect(() => {
        bus.source = renderer;
        const off = renderer.onKeys(() => bus.keysChanged());
        return () => { off(); if (bus.source === renderer) bus.source = null; };
    }, [bus, renderer]);
    useLayoutEffect(() => {
        bus.setPlacement(placement, keys);
        if (!tweening && bus.projector) bus.settle();
    }, [bus, placement, keys, tweening]);

    // The overlay: selection + its incident slice + the path; hover rides along without a React commit.
    const overlayOf = (hover: number): OverlayState => {
        const slot = bus.slotOf(selected);
        const path = (options.path ?? []).map((k) => bus.slotOf(k)).filter((s) => s >= 0);
        return { selected: slot, hover, path, incident: options.incident?.of(slot, INCIDENT_SHOWN) ?? [] };
    };
    const latest = useRef(overlayOf);
    latest.current = overlayOf;
    useEffect(() => {
        renderer.setOverlay(latest.current(bus.hover));
        bus.invalidate();
    }, [renderer, bus, selected, placement, options.path, options.incident]);
    useEffect(() => bus.onHover((hover) => { renderer.setOverlay({ ...renderer.overlay, hover }); bus.invalidate(); }), [bus, renderer]);

    // Pointer picking on the stage's box: hover on move, select on a click that did not drag.
    useEffect(() => {
        const box = own.current?.parentElement;
        if (!box) return undefined;
        let down: { x: number; y: number } | null = null;
        const at = (e: PointerEvent) => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        const move = (e: PointerEvent) => {
            const p = at(e), hit = bus.pick(p.x, p.y);
            bus.setHover(hit?.kind === 'mark' ? hit.slot : -1);
            box.style.cursor = hit ? 'pointer' : '';
        };
        const press = (e: PointerEvent) => { down = at(e); };
        const release = (e: PointerEvent) => {
            const p = at(e), from = down;
            down = null;
            if (!from || Math.hypot(p.x - from.x, p.y - from.y) > CLICK_SLOP_PX) return;
            const hit = bus.pick(p.x, p.y);
            if (hit?.kind === 'mark') { const key = bus.keys[hit.slot]; if (key) select.current(key); }
            else if (hit?.kind === 'link') bus.options.onLink?.(hit, p);
        };
        const leave = () => { bus.setHover(-1); box.style.cursor = ''; };
        box.addEventListener('pointermove', move);
        box.addEventListener('pointerdown', press);
        box.addEventListener('pointerup', release);
        box.addEventListener('pointerleave', leave);
        return () => {
            box.removeEventListener('pointermove', move); box.removeEventListener('pointerdown', press);
            box.removeEventListener('pointerup', release); box.removeEventListener('pointerleave', leave);
        };
    }, [bus]);

    return (
        <div ref={own} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-stage-interaction>
            <StageProxies bus={bus} selected={selected} disabled={tweening} description={description} onSelect={onSelect} onOut={onOut} />
        </div>
    );
}

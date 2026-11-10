/**
 * `useSlotAnchor(key, ref)` (PRD 43 B3 Cards): keeps a DOM element (a station card) beside the mark of slot `key`. The
 * element's transform is written from the stage's frame loop (every camera frame the bus forwards), so a pan, zoom or
 * tilt moves the card with NO React commit. During a placement tween the card is HIDDEN (`visibility`, set directly)
 * — the marks are between placements — and shown again, re-anchored, when it lands. The element is placed with its
 * real size beside the mark's projected box by `placeCard` (flipped to the side that fits and keeps clear of `avoid`),
 * and `missing` turns true when the slot is hidden (scale 0) or gone at a settle — the only time this hook re-renders
 * its caller.
 *
 * Replaces `useCardAnchor` (which measured SVG `data-station` boxes) for stage cameras.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, placeCard, type Rect } from '../../surface/transit/cardPlacement';
import type { Projector } from '../pick';
import { useStageBus, type StageBus } from './stageBus';

export interface SlotAnchorOptions {
    /** Screen boxes the element must keep clear of (the unfolded satellites). */
    avoid?: () => readonly Rect[];
}

/** The smallest box a mark counts as on screen (a far-zoomed mark is still a target). */
const MIN_BOX = 12;
const scratch = new Float64Array(2);

/** Where the element goes beside slot `slot` under `projector`, or null when the slot is not drawn there. */
export function anchorOf(bus: StageBus, slot: number, projector: Projector, size: { width: number; height: number }, avoid: readonly Rect[] = []): { left: number; top: number } | null {
    const p = bus.placement;
    if (!p || slot < 0 || !(p.scale[slot]! > 0)) return null;
    const x = p.position[slot * 3]!, y = p.position[slot * 3 + 1]! + (p.extrude[slot] ?? 0) * bus.extrudeScale(), z = p.position[slot * 3 + 2]!;
    if (!projector.project(x, y, z, scratch)) return null;
    const half = Math.max(MIN_BOX, p.scale[slot]! * projector.pxPerWorld);
    const box: Rect = { left: scratch[0]! - half, top: scratch[1]! - half, width: half * 2, height: half * 2 };
    return placeCard(box, { width: projector.width, height: projector.height }, size, avoid);
}

export function useSlotAnchor(key: string | null, ref: RefObject<HTMLElement | null>, opts: SlotAnchorOptions = {}): { missing: boolean } {
    const bus = useStageBus();
    const [missing, setMissing] = useState(false);
    const avoid = opts.avoid;

    useLayoutEffect(() => {
        if (!key) { setMissing(false); return undefined; }
        let last = '';
        const write = (projector: Projector | null) => {
            const el = ref.current;
            if (!el || !projector) return;
            const size = { width: el.offsetWidth || CARD_WIDTH, height: el.offsetHeight || CARD_HEIGHT };
            const at = anchorOf(bus, bus.slotOf(key), projector, size, avoid?.());
            if (!at) return;
            const transform = `translate3d(${Math.round(at.left)}px, ${Math.round(at.top)}px, 0)`;
            if (transform === last) return;
            last = transform;
            el.style.transform = transform;
        };
        const check = () => {
            const slot = bus.slotOf(key);
            const gone = !bus.placement || slot < 0 || !(bus.placement.scale[slot]! > 0);
            setMissing((cur) => (cur === gone ? cur : gone));
        };
        const tween = (on: boolean) => { const el = ref.current; if (el) el.style.visibility = on ? 'hidden' : ''; };
        write(bus.projector);
        check();
        tween(bus.tweening);
        const offFrame = bus.onFrame((projector) => { if (!bus.tweening) write(projector); });
        const offSettle = bus.onSettle(() => { write(bus.projector); check(); });
        const offTween = bus.onTween(tween);
        return () => { offFrame(); offSettle(); offTween(); tween(false); };
    }, [bus, key, ref, avoid]);

    return { missing };
}

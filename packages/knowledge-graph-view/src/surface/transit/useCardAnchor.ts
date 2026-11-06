/**
 * Measures where a station is inside the map's box so the card can sit beside it. The station is found
 * by its `data-station` attribute. The card is placed with its REAL size (it is measured, and measured
 * again when it resizes), re-placed when the map scrolls sideways, kept clear of the unfolded
 * satellites, and reported `missing` when the station is not on the map any more (the caller closes the card).
 * `deps` say when the geometry may have changed (zoom, layout).
 */

import { useCallback, useLayoutEffect, useState, type DependencyList, type RefObject } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, placeCard, type Rect } from './cardPlacement';

export interface CardAnchor { left: number; top: number; missing: boolean }

export function useCardAnchor(
    box: RefObject<HTMLElement | null>,
    scroller: RefObject<HTMLElement | null>,
    card: RefObject<HTMLElement | null>,
    stationId: string | null,
    keepClear: boolean,
    deps: DependencyList,
): CardAnchor {
    const [at, setAt] = useState<CardAnchor>({ left: 0, top: 0, missing: false });
    const [tick, setTick] = useState(0);
    const bump = useCallback(() => setTick((n) => n + 1), []);

    // The map scrolling sideways, or the card changing size, moves where the card belongs.
    useLayoutEffect(() => {
        if (!stationId) return;
        const host = scroller.current, mine = card.current;
        host?.addEventListener('scroll', bump, { passive: true });
        const watch = typeof ResizeObserver === 'undefined' || !mine ? undefined : new ResizeObserver(bump);
        if (mine) watch?.observe(mine);
        return () => { host?.removeEventListener('scroll', bump); watch?.disconnect(); };
    }, [scroller, card, stationId, bump]);

    useLayoutEffect(() => {
        const host = box.current;
        if (!stationId) { setAt((cur) => (cur.missing ? { ...cur, missing: false } : cur)); return; }
        if (!host) return;
        const mark = [...host.querySelectorAll('[data-station]')].find((el) => el.getAttribute('data-station') === stationId);
        if (!mark) { setAt((cur) => (cur.missing ? cur : { ...cur, missing: true })); return; }
        const outer = host.getBoundingClientRect(), r = mark.getBoundingClientRect();
        const rel = (b: DOMRect): Rect => ({ left: b.left - outer.left, top: b.top - outer.top, width: b.width, height: b.height });
        const size = { width: card.current?.offsetWidth || CARD_WIDTH, height: card.current?.offsetHeight || CARD_HEIGHT };
        const avoid = keepClear ? [...host.querySelectorAll('[data-satellite]')].map((el) => rel(el.getBoundingClientRect())) : [];
        const placed = placeCard(rel(r), { width: outer.width, height: outer.height || 480 }, size, avoid);
        setAt((cur) => (cur.left === placed.left && cur.top === placed.top && !cur.missing ? cur : { ...placed, missing: false }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [box, card, stationId, keepClear, tick, ...deps]);
    return at;
}

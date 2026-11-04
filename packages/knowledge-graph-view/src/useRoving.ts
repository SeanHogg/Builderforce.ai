/**
 * Roving focus over the focusable `<g data-id>` nodes of an SVG: only a few are tab stops, arrow keys
 * walk their DOM order (importance order), and keyboard focus gets a ring the host draws in the accent token.
 */

import { useCallback, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';

export interface Roving {
    /** The node with KEYBOARD focus (a mouse click draws no ring). */
    ring: string | null;
    onFocus(e: FocusEvent<SVGElement>): void;
    onBlur(): void;
    onArrow(e: KeyboardEvent<SVGElement>): void;
}

const STEP: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function useRoving(): Roving {
    // The node last focused is the roving tab stop, moved through the DOM so the node layer never re-renders for it.
    const last = useRef<Element | null>(null);
    const [ring, setRing] = useState<string | null>(null);
    const onFocus = useCallback((e: FocusEvent<SVGElement>) => {
        const id = (e.target as Element).getAttribute('data-id');
        if (!id) return;
        const el = e.target as Element;
        if (last.current && last.current !== el && !last.current.hasAttribute('data-keep')) last.current.setAttribute('tabindex', '-1');
        el.setAttribute('tabindex', '0');
        last.current = el;
        let visible = true;
        try { visible = (e.target as Element).matches(':focus-visible'); } catch { /* no :focus-visible: ring every focus */ }
        setRing(visible ? id : null);
    }, []);
    const onBlur = useCallback(() => setRing(null), []);
    const onArrow = useCallback((e: KeyboardEvent<SVGElement>) => {
        const step = STEP[e.key];
        if (!step) return;
        e.preventDefault();
        const next = step > 0 ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
        (next as SVGElement | null)?.focus();
    }, []);
    return { ring, onFocus, onBlur, onArrow };
}

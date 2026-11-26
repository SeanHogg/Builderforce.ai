/**
 * The scroll + measure + window state of a virtualized column of fixed-height rows (the code pane's lines, the docked
 * outline's members). The scroll container takes `ref` and `onScroll`; the rows `[from, to)` are the ones to render, in a
 * box `padTop` / `padBottom` px padded (or, absolutely placed, `total * rowPx` tall: `virtual`). Before the container has
 * measured itself (no layout: jsdom, first paint) it assumes `viewRows` rows are on show. `measureKey` re-measures when
 * the container appears or changes size class.
 */

import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import { visibleWindow, VIRTUAL_AFTER } from './codeText';

/** The rows a virtualized panel renders before it has measured itself. */
const VIEW_ROWS = 16;

export interface VirtualRowsOptions {
    /** Rows rendered plainly up to this many (default `VIRTUAL_AFTER`). */
    after?: number | undefined;
    /** Rows assumed on show before the container measures itself (default `VIEW_ROWS`). */
    viewRows?: number | undefined;
    /** Re-measure the container when this changes. */
    measureKey?: unknown;
}

export interface VirtualRows<E extends HTMLElement> {
    ref: { current: E | null };
    onScroll(e: UIEvent<HTMLElement>): void;
    scrollTop: number;
    viewPx: number;
    from: number;
    to: number;
    /** More rows than `after`: only `[from, to)` are rendered. */
    virtual: boolean;
    padTop: number;
    padBottom: number;
    /** Scroll the container to `top` px (state and element both). */
    scrollTo(top: number): void;
    /** Scroll row `index` into view when it is outside what the container shows. */
    reveal(index: number): void;
}

export function useVirtualRows<E extends HTMLElement = HTMLDivElement>(
    total: number, rowPx: number, { after = VIRTUAL_AFTER, viewRows = VIEW_ROWS, measureKey }: VirtualRowsOptions = {},
): VirtualRows<E> {
    const ref = useRef<E | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewPx, setViewPx] = useState(0);
    useLayoutEffect(() => { setViewPx(ref.current?.clientHeight ?? 0); }, [measureKey]);
    const onScroll = useCallback((e: UIEvent<HTMLElement>) => { setScrollTop(e.currentTarget.scrollTop); setViewPx(e.currentTarget.clientHeight); }, []);
    const scrollTo = useCallback((top: number) => {
        setScrollTop(top);
        if (ref.current && ref.current.scrollTop !== top) ref.current.scrollTop = top;
    }, []);
    const { from, to } = visibleWindow(total, scrollTop, rowPx, viewPx > 0 ? Math.ceil(viewPx / rowPx) : viewRows, after);
    // The latest window, for `reveal` (kept out of its identity so an effect calling it is not re-run by every scroll).
    const shown = useRef({ from, to, rowPx });
    shown.current = { from, to, rowPx };
    const reveal = useCallback((index: number) => {
        const el = ref.current, at = shown.current;
        const top = index * at.rowPx, h = el?.clientHeight ?? 0;
        const inView = h > 0 ? top >= (el?.scrollTop ?? 0) && top + at.rowPx <= (el?.scrollTop ?? 0) + h : index >= at.from && index < at.to;
        if (!inView) scrollTo(top);
    }, [scrollTo]);
    const virtual = total > after;
    return { ref, onScroll, scrollTop, viewPx, from, to, virtual, padTop: virtual ? from * rowPx : 0, padBottom: virtual ? Math.max(0, total - to) * rowPx : 0, scrollTo, reveal };
}

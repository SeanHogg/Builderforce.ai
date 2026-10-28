/**
 * What the host can draw: WebGL, motion preference, and the container's width. The list
 * is the FIRST paint everywhere; the 3D chunk loads only when WebGL exists and motion is
 * allowed (PRD 38 §5.6).
 */

import { useEffect, useState, type RefObject } from 'react';

export function hasWebGL(): boolean {
    if (typeof document === 'undefined') return false;
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
        return false;
    }
}

export function prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Whether the 3D scene may load, read once after mount (never during SSR). */
export function useCan3D(): boolean {
    const [can, setCan] = useState(false);
    useEffect(() => { setCan(hasWebGL() && !prefersReducedMotion()); }, []);
    return can;
}

/** The element's width, tracked with a ResizeObserver; 0 before it measures. */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        setWidth(el.getBoundingClientRect().width);
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width;
            if (w !== undefined) setWidth(w);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);
    return width;
}

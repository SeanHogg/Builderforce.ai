/**
 * What the host can draw: WebGL, motion preference, and the container's size. The 2D graph
 * is the default view everywhere; the 3D chunk loads only when WebGL exists (PRD 38 §5.6).
 * Reduced motion does not hide 3D, it only turns off the camera fly.
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

export interface RenderEnvironment {
    webgl: boolean;
    reducedMotion: boolean;
}

/** What the host can draw, read once after mount (never during SSR). Reduced motion only stills the camera; it never hides 3D. */
export function useRenderEnvironment(): RenderEnvironment {
    const [env, setEnv] = useState<RenderEnvironment>({ webgl: false, reducedMotion: false });
    useEffect(() => { setEnv({ webgl: hasWebGL(), reducedMotion: prefersReducedMotion() }); }, []);
    return env;
}

export interface ContainerSize {
    width: number;
    height: number;
}

/** The element's size, tracked with a ResizeObserver; 0×0 before it measures. */
export function useContainerSize(ref: RefObject<HTMLElement | null>): ContainerSize {
    const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const set = (width: number, height: number) => setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
        const rect = el.getBoundingClientRect();
        set(rect.width, rect.height);
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver((entries) => {
            const box = entries[0]?.contentRect;
            if (box) set(box.width, box.height);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);
    return size;
}

/** The element's width, tracked with a ResizeObserver; 0 before it measures. */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
    return useContainerSize(ref).width;
}

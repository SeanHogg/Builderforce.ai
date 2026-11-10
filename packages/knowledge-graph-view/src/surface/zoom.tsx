/**
 * The zoom contract. The +, − and Fit buttons live in the scene overlay and must work for EVERY
 * camera, so a camera does not draw buttons of its own: the ACTIVE camera registers a
 * {@link ZoomApi} and the overlay calls it: the stage through its rig (`usePanZoomRegistration`),
 * the List through CSS scale (`ScaleZoom`). A camera that registers nothing gets disabled buttons.
 *
 * The host of the scene owns one registry (`useZoomHost`), wraps the cameras in a
 * `ZoomProvider` and hands the registered api to the overlay. A camera outside a provider (a
 * unit test, a drawer) registers into nothing and still renders.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** What a camera's own pan/zoom offers the overlay: a zoom about the centre, and back to the fitted view (the stage's rig). */
export interface PanZoom {
    zoomBy(factor: number): void;
    reset(): void;
}

export interface ZoomApi {
    zoomIn(): void;
    zoomOut(): void;
    /** Back to the whole picture. */
    fit(): void;
}

export interface ZoomRegistry {
    /** The active camera's api; null while it registers none. */
    api: ZoomApi | null;
    register(api: ZoomApi): void;
    /** Releases `api` only if it is still the registered one (a newer camera's api is left alone). */
    unregister(api: ZoomApi): void;
}

/** ONE registry per scene; call it in the component that renders both the cameras and the overlay. */
export function useZoomHost(): ZoomRegistry {
    const [api, setApi] = useState<ZoomApi | null>(null);
    const register = useCallback((next: ZoomApi) => setApi(next), []);
    const unregister = useCallback((gone: ZoomApi) => setApi((cur) => (cur === gone ? null : cur)), []);
    return useMemo(() => ({ api, register, unregister }), [api, register, unregister]);
}

const Context = createContext<Pick<ZoomRegistry, 'register' | 'unregister'> | null>(null);

export function ZoomProvider({ host, children }: { host: Pick<ZoomRegistry, 'register' | 'unregister'>; children: ReactNode }) {
    return <Context.Provider value={host}>{children}</Context.Provider>;
}

/** Registers `api` while the calling camera is mounted. `api` must be referentially stable (memoize it). */
export function useRegisterZoom(api: ZoomApi): void {
    const host = useContext(Context);
    useEffect(() => {
        if (!host) return undefined;
        host.register(api);
        return () => host.unregister(api);
    }, [host, api]);
}

export const ZOOM_STEP = 1.4;

/** Registers a camera's own pan/zoom (the stage's rig, `stage/rig/useRig.ts`): in, out, and back to the fitted view. */
export function usePanZoomRegistration(pan: PanZoom): void {
    const ref = useRef(pan);
    ref.current = pan;
    const api = useMemo<ZoomApi>(() => ({
        zoomIn: () => ref.current.zoomBy(ZOOM_STEP),
        zoomOut: () => ref.current.zoomBy(1 / ZOOM_STEP),
        fit: () => ref.current.reset(),
    }), []);
    useRegisterZoom(api);
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;

/** The next scale of a CSS-scaled camera, kept within the cap. */
export const clampScale = (scale: number, factor: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * factor * 100) / 100));

/**
 * Zoom for the camera made of HTML (the List): the content is scaled with
 * CSS `zoom` (layout follows, so the scene's own scrollbars reach the enlarged content) and Fit
 * returns to 1. `data-scale` carries the value for tests and assistive inspection.
 */
export function ScaleZoom({ children }: { children: ReactNode }) {
    const [scale, setScale] = useState(1);
    const api = useMemo<ZoomApi>(() => ({
        zoomIn: () => setScale((s) => clampScale(s, ZOOM_STEP)),
        zoomOut: () => setScale((s) => clampScale(s, 1 / ZOOM_STEP)),
        fit: () => setScale(1),
    }), []);
    useRegisterZoom(api);
    return <div data-scale={scale} style={{ zoom: scale }}>{children}</div>;
}

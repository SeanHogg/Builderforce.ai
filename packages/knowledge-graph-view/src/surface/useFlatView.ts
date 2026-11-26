/**
 * The ONE 3D / Flat switch's state (PRD 43 C4): `flat` is the viewer's choice, kept per viewer in localStorage (through
 * `viewerStorage`, like the panels' visibility). The stored choice is read synchronously on the first client render (a
 * lazy initialiser), so a viewer who chose Flat never sees a 3D frame first; where there is no `window` (the server) it
 * is 3D. `FlatViewContext` hands the ONE setter to the panels that must switch to 3D (Show in tower).
 */

import { createContext, useCallback, useState } from 'react';
import { readStored, writeStored } from './viewerStorage';

export const FLAT_VIEW_KEY = 'kg.flatView.v1';

export interface FlatView {
    flat: boolean;
    setFlat(flat: boolean): void;
}

/** The view's `setFlat`, for descendants that switch the picture (Show in tower goes to 3D through it); null outside a view. */
export const FlatViewContext = createContext<((flat: boolean) => void) | null>(null);

export function useFlatView(): FlatView {
    const [flat, setState] = useState(() => typeof window !== 'undefined' && readStored(FLAT_VIEW_KEY) === true);
    const setFlat = useCallback((next: boolean) => { setState(next); writeStored(FLAT_VIEW_KEY, next); }, []);
    return { flat, setFlat };
}

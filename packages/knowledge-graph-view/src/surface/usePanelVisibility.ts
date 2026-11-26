/**
 * Which panels are shown: the left (lines) and the stage's code pane. Both shown by default; the choice is kept per
 * viewer in localStorage. This is the only module that touches storage for it, and every read and write is guarded, so a blocked store just means "not remembered".
 */

import { useCallback, useEffect, useState } from 'react';
import { readStored, writeStored } from './viewerStorage';

/** The dock `DockEdge` draws an edge for. */
export type PanelSlot = 'left';
/** Every slot with a remembered visibility: the docks and the stage's code pane (`code`, PRD 43 Part C1), which draws its own hide control. */
export type VisibilitySlot = PanelSlot | 'code';
export type PanelVisibility = Record<VisibilitySlot, boolean>;

export const PANEL_VISIBILITY_KEY = 'kg.panelVisibility.v1';
const ALL_SHOWN: PanelVisibility = { left: true, code: true };

function read(): PanelVisibility {
    const parsed = readStored(PANEL_VISIBILITY_KEY) as Partial<Record<VisibilitySlot, unknown>> | null;
    if (!parsed || typeof parsed !== 'object') return ALL_SHOWN;
    return { left: parsed.left !== false, code: parsed.code !== false };
}

const write = (v: PanelVisibility): void => writeStored(PANEL_VISIBILITY_KEY, v);

export function usePanelVisibility() {
    // All shown on the first render (server and client agree); the stored choice is read after mount.
    const [visibility, setVisibility] = useState<PanelVisibility>(ALL_SHOWN);
    useEffect(() => { setVisibility(read()); }, []);
    const toggle = useCallback((id: VisibilitySlot) => {
        setVisibility((v) => {
            const next = { ...v, [id]: !v[id] };
            write(next);
            return next;
        });
    }, []);
    return { visibility, toggle };
}

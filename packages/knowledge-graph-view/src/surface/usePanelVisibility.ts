/**
 * Which panels are shown: the left (lines), the bottom (path strip), the right (act panel) and the stage's code pane. All shown by default; the choice is kept per
 * viewer in localStorage. This is the only module that touches storage for it, and every read and write is guarded, so a blocked store just means "not remembered".
 */

import { useCallback, useEffect, useState } from 'react';

/** The three docks `DockEdge` draws an edge for. */
export type PanelSlot = 'left' | 'bottom' | 'right';
/** Every slot with a remembered visibility: the docks and the stage's code pane (`code`, PRD 43 Part C1), which draws its own hide control. */
export type VisibilitySlot = PanelSlot | 'code';
export type PanelVisibility = Record<VisibilitySlot, boolean>;

export const PANEL_VISIBILITY_KEY = 'kg.panelVisibility.v1';
const ALL_SHOWN: PanelVisibility = { left: true, bottom: true, right: true, code: true };

function read(): PanelVisibility {
    try {
        const raw = window.localStorage.getItem(PANEL_VISIBILITY_KEY);
        const parsed = raw ? JSON.parse(raw) as Partial<Record<VisibilitySlot, unknown>> : null;
        if (!parsed || typeof parsed !== 'object') return ALL_SHOWN;
        return { left: parsed.left !== false, bottom: parsed.bottom !== false, right: parsed.right !== false, code: parsed.code !== false };
    } catch {
        return ALL_SHOWN;
    }
}

function write(v: PanelVisibility): void {
    try {
        window.localStorage.setItem(PANEL_VISIBILITY_KEY, JSON.stringify(v));
    } catch {
        /* storage blocked: the choice lasts for this session only */
    }
}

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

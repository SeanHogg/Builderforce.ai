/**
 * Which of the three side panels are shown: the left (lines), the bottom (path strip) and the right (act panel). All shown by default; the choice is kept per
 * viewer in localStorage. This is the only module that touches storage for it, and every read and write is guarded, so a blocked store just means "not remembered".
 */

import { useCallback, useState } from 'react';

export type PanelSlot = 'left' | 'bottom' | 'right';
export type PanelVisibility = Record<PanelSlot, boolean>;

export const PANEL_VISIBILITY_KEY = 'kg.panelVisibility.v1';
const ALL_SHOWN: PanelVisibility = { left: true, bottom: true, right: true };

function read(): PanelVisibility {
    try {
        const raw = window.localStorage.getItem(PANEL_VISIBILITY_KEY);
        const parsed = raw ? JSON.parse(raw) as Partial<Record<PanelSlot, unknown>> : null;
        if (!parsed || typeof parsed !== 'object') return ALL_SHOWN;
        return { left: parsed.left !== false, bottom: parsed.bottom !== false, right: parsed.right !== false };
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
    const [visibility, setVisibility] = useState<PanelVisibility>(read);
    const toggle = useCallback((id: PanelSlot) => {
        setVisibility((v) => {
            const next = { ...v, [id]: !v[id] };
            write(next);
            return next;
        });
    }, []);
    return { visibility, toggle };
}

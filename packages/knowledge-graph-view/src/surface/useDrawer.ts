/**
 * The drawer's open state, in one place. A registry panel (`surface.panel`: Coverage, Fix, Reviews...) is open when it is set; the Act tab has no panel id, so
 * it keeps its own open flag. So "open the drawer at a tab" is one call from anywhere: a card action's `setPanel('coverage')` opens it on that tab, the edge
 * chevron opens it on Act, and closing clears both.
 */

import { useCallback, useState } from 'react';

export const ACT_TAB = 'act';

export interface DrawerState {
    open: boolean;
    /** The selected tab: `act` or a panel id. */
    tab: string;
    /** Selects a tab (opening the drawer). */
    pick(id: string): void;
    close(): void;
    toggle(): void;
}

/** `panel` is the surface's open panel id; `setPanel` its (Reviews-aware) opener. */
export function useDrawer(panel: string | null, setPanel: (id: string | null) => void): DrawerState {
    const [actOpen, setActOpen] = useState(false);
    const open = panel !== null || actOpen;
    const pick = useCallback((id: string) => {
        if (id === ACT_TAB) { setActOpen(true); setPanel(null); } else { setActOpen(false); setPanel(id); }
    }, [setPanel]);
    const close = useCallback(() => { setActOpen(false); setPanel(null); }, [setPanel]);
    return { open, tab: panel ?? ACT_TAB, pick, close, toggle: () => (open ? close() : pick(ACT_TAB)) };
}

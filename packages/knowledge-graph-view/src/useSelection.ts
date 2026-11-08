/** The multiselect state both finding lists share (the Findings panel and the Patterns groups): a set of ids with toggle, select-all and clear. */

import { useCallback, useState } from 'react';

export interface Selection {
    selected: ReadonlySet<string>;
    toggle(id: string): void;
    setAll(ids: Iterable<string>): void;
    clear(): void;
}

export function useSelection(): Selection {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const toggle = useCallback((id: string) => setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    }), []);
    const setAll = useCallback((ids: Iterable<string>) => setSelected(new Set(ids)), []);
    const clear = useCallback(() => setSelected(new Set()), []);
    return { selected, toggle, setAll, clear };
}

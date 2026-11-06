/**
 * Keeps the number of stations readable on a huge repo: when there are more groups than the cap,
 * area groups fold into their parent directory (one level at a time) until the count is under
 * the cap or no area has a parent left. Folder groups (files without an area) are not folded.
 */

import type { KNode } from '@seanhogg/builderforce-memory/knowledge';

export const MAX_STATIONS = 400;

export interface Group { id: string; name: string; kind: 'area' | 'folder'; nodes: KNode[] }

/** The ref one directory up (`src:r::a/b` -> `src:r::a`), or null at the top of the area path. */
export function parentAreaRef(ref: string): string | null {
    const start = ref.indexOf('::') + 2;
    const slash = ref.lastIndexOf('/');
    return slash >= start && slash > 0 ? ref.slice(0, slash) : null;
}

export function rollUpAreas(groups: Map<string, Group>, nameOf: (id: string) => string, cap = MAX_STATIONS): Map<string, Group> {
    let current = groups;
    while (current.size > cap) {
        const next = new Map<string, Group>();
        let folded = false;
        for (const g of current.values()) {
            const parent = g.kind === 'area' ? parentAreaRef(g.id) : null;
            const id = parent ?? g.id;
            if (parent) folded = true;
            const into = next.get(id) ?? { id, name: parent ? nameOf(id) : g.name, kind: g.kind, nodes: [] };
            into.nodes.push(...g.nodes);
            next.set(id, into);
        }
        if (!folded) return current;
        current = next;
    }
    return current;
}

/**
 * Domains drawer, the one choice the view makes itself: which folder to propose for first — the one holding the
 * most loose code files. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

const CODE_FILE = /\.(ts|tsx|mts|js|mjs)$/;

/** Root-relative folders of the graph's code files, the one with the most files directly in it first ('' = the root). */
export function foldersByLooseFiles(graph: KnowledgeGraph, rootId: string): string[] {
    const prefix = `src:${rootId}::`;
    const counts = new Map<string, number>();
    for (const node of graph.nodes) {
        if (node.kind !== 'file' || node.pack !== 'code' || !node.ref.startsWith(prefix)) continue;
        const path = node.ref.slice(prefix.length);
        if (!CODE_FILE.test(path)) continue;
        const folder = path.slice(0, Math.max(0, path.lastIndexOf('/')));
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([folder]) => folder);
}

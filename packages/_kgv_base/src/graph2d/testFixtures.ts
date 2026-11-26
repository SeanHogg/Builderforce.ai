/**
 * A monorepo-shaped graph for the 2D camera's tests: five partitions plus "no partition", each with folders that carry
 * LONG path labels and many files under them, linked inside and across partitions. Shaped after the screen that showed
 * empty bands with every node slid off to the left and folder captions piled on one another.
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';

export const PARTITIONS = ['presentation', 'entry', 'application', 'domain', 'infrastructure', ''] as const;

export function partitionedFixture(perPartition = 30): { nodes: KNode[]; edges: KEdge[] } {
    const nodes: KNode[] = [];
    const edges: KEdge[] = [];
    const ref = (path: string) => `src:mono::${path}` as KNode['ref'];
    PARTITIONS.forEach((partition, p) => {
        const area = partition || 'misc';
        for (let i = 0; i < perPartition; i++) {
            const folder = i < 4;
            const path = folder ? `hired.video/frontend/lib/${area}/editor-v${i}` : `hired.video/api/src/${area}/file${i}.ts`;
            nodes.push({
                ref: ref(path), kind: folder ? 'folder' : 'file', label: path, pack: 'code', origin: 'extracted',
                importance: folder ? 0.95 - i * 0.01 : 0.2 + ((i * 7 + p) % 10) / 20,
                ...(partition ? { partition } : {}),
            } as KNode);
        }
    });
    const link = (a: KNode, b: KNode) => edges.push({ from: a.ref as KEdge['from'], to: b.ref as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted' });
    for (let i = 0; i < nodes.length; i++) {
        link(nodes[i]!, nodes[(i + 1) % nodes.length]!);
        link(nodes[i]!, nodes[(i * 13 + 5) % nodes.length]!);
    }
    return { nodes, edges };
}

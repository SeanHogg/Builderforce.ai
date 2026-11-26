/**
 * Fixtures for the outline tests: a whole system whose graph the server cut to ONE node. Two
 * entry files in two areas, a web area, an api area and an infrastructure folder.
 */

import type { GraphOutline, KnowledgeGraph, KNode, NodeRef } from '@seanhogg/builderforce-memory/knowledge';

export const PREFIX = 'src:sys::';
export const ref = (path: string) => `${PREFIX}${path}` as NodeRef;

export function outlineFixture(): GraphOutline {
    return {
        prefix: PREFIX,
        areas: [ref('area:api'), ref('area:jobs'), ref('area:web')],
        partitions: ['application', 'entry', 'infrastructure', 'presentation'],
        files: [
            { path: 'api/useCase.ts', area: 0, partition: 0, importance: 0.8, badges: { complexity: 6, coverage: 0.5, notABadgeKey: 1 } },
            { path: 'cron.ts', area: 1, partition: 1, importance: 0.3 },
            { path: 'db/repo.ts', partition: 2, importance: 0.4 },
            { path: 'main.tsx', area: 2, partition: 1, importance: 0.5 },
            { path: 'web/App.tsx', area: 2, partition: 3, importance: 0.6, hash: 'abc' },
        ],
        links: [
            [0, 2, 2, 0], // useCase -> repo (allowed)
            [0, 4, 4, 1], // useCase -> App (upward, in a cycle)
            [1, 0, 3, 0], // cron -> useCase (skips)
            [3, 4, 2, 0], // main -> App (allowed)
            [4, 0, 0, 0], // App -> useCase (no verdict)
        ],
        capped: false,
    };
}

/** A graph the server cut to ONE node: on its own it is "1 line, 1 stop". */
export function truncatedFixture(withOutline: boolean, kept: Partial<KNode> = {}): KnowledgeGraph {
    const node: KNode = {
        ref: ref('main.tsx'), kind: 'file', label: 'main.tsx', pack: 'code', partition: 'entry', area: ref('area:web'),
        importance: 0.5, origin: 'extracted', ...kept,
    };
    return {
        scope: { rootId: 'sys', packs: ['code'], digest: 'd' },
        nodes: [node], edges: [], findings: [],
        stats: { sources: 5, nodes: 1, edges: 0, stale: 0, truncated: true },
        ...(withOutline ? { outline: outlineFixture() } : {}),
    };
}

/**
 * The edit contract's enforcement: a graph that is resident is never changed in place. In development its `nodes` and `edges`
 * arrays are frozen when they become resident, so an in-place `push`/`splice`/`sort` throws where it happens instead of
 * leaving the worker's copy, the cached indices and the memo chains silently stale. Production skips the (cheap) freeze.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

/** Same guard as `memo.ts`: safe where `process` does not exist, and folded away by a bundler's `NODE_ENV` define. */
export const isDevBuild = (): boolean => typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

export function freezeGraph(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): void {
    if (!isDevBuild()) return;
    Object.freeze(graph.nodes);
    Object.freeze(graph.edges);
}

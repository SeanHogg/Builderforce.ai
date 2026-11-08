/**
 * The edit contract's enforcement: a graph that is resident is never changed in place. In development its `nodes` and `edges`
 * arrays are frozen when they become resident, so an in-place `push`/`splice`/`sort` throws where it happens instead of
 * leaving the worker's copy, the cached indices and the memo chains silently stale. Production skips the (cheap) freeze.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

import { isDevBuild } from '../devBuild';

export function freezeGraph(graph: Pick<KnowledgeGraph, 'nodes' | 'edges' | 'findings'>): void {
    if (!isDevBuild()) return;
    Object.freeze(graph.nodes);
    Object.freeze(graph.edges);
    Object.freeze(graph.findings);
}

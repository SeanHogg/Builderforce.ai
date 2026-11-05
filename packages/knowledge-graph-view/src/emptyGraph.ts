/**
 * The graph the surface composes over while there is no real one yet (first open, nothing
 * remembered): every memo and camera runs on it unchanged, and `SceneState` is drawn in the
 * scene in place of the map. One constant, so a reference compare stays cheap.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

export const EMPTY_GRAPH: KnowledgeGraph = {
    scope: { rootId: '', packs: [], digest: '' },
    nodes: [],
    edges: [],
    findings: [],
    stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
};

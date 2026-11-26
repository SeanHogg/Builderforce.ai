/**
 * The ranked edges of a graph, as a hook: in the same render for a small edge set, in the compute worker for a big one, and
 * not at all when `enabled` is false. Used by the 2D scene, which needs the ranking itself (the 3D scene asks the worker for
 * the drawn buffers directly, so it never ranks on this side).
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { useComputed } from '../compute/useComputed';
import { DEFER_EDGES_ABOVE, type RankedEdges } from './edgeBudget';

export function useRankedEdges(edges: readonly KEdge[], nodes: readonly Pick<KNode, 'ref' | 'importance'>[], enabled = true): RankedEdges | null {
    return useComputed('rankEdges', { nodes, edges }, [nodes, edges], null, { enabled, inline: edges.length <= DEFER_EDGES_ABOVE, keep: false }).value;
}

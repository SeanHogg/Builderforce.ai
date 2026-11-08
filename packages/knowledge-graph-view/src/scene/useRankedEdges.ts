/**
 * The ranked edges of a graph, as a hook: in the same render for a small edge set, in idle steps (one stage per slice)
 * for a big one, and not at all when `enabled` is false. Shared by the 2D and 3D scenes, so neither rank the edges its own way.
 */

import { useMemo } from 'react';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { useIdleSteps } from '../useIdleSteps';
import { DEFER_EDGES_ABOVE, rankEdges, rankTask, type RankedEdges } from './edgeBudget';

export function useRankedEdges(edges: readonly KEdge[], nodes: readonly Pick<KNode, 'ref' | 'importance'>[], enabled = true): RankedEdges | null {
    const big = edges.length > DEFER_EDGES_ABOVE;
    const now = useMemo(() => (enabled && !big ? rankEdges(edges, nodes) : null), [enabled, big, edges, nodes]);
    const later = useIdleSteps(() => rankTask(edges, nodes), [edges, nodes], undefined, enabled && big);
    return now ?? later;
}

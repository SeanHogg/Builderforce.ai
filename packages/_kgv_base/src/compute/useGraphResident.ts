/**
 * Makes a graph resident for the views drawn from it. Registering is done in the render (idempotent, no worker work), so a
 * child that names a subset of this graph finds the graph held; the post to the worker is an effect, and starts early so the
 * first task finds its graph loaded.
 */

import { useEffect, useMemo } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { getComputeClient } from './sharedClient';

export function useGraphResident(graph: KnowledgeGraph | null): void {
    const client = getComputeClient();
    useMemo(() => { if (graph) client.residency.graphId(graph); }, [client, graph]);
    useEffect(() => {
        if (!graph) return undefined;
        client.retain();
        client.prefetch(graph);
        return () => client.release();
    }, [client, graph]);
}

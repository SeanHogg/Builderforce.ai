/**
 * `focusGraph` builds new arrays whenever the selection changes (it keeps the selected node), even when the
 * selected node was already inside the drawn set. Everything downstream (the 3D/2D layout, the edge ranking, the
 * buffers) is keyed on array identity, so a click would restart them all. `stableGraph` hands back the PREVIOUS
 * object when the new one holds the same nodes and edges, so identity changes only when the content does.
 *
 * `focusGraph` now returns its cached base arrays while the selection stays inside the drawn set, so this hook is rarely the
 * thing that keeps identity. It is kept on purpose as the content-signature guard for the other case: the selection steps
 * outside the base and back (new arrays with the same content), and the lens/compact toggles that rebuild equal arrays.
 */

import { useRef } from 'react';
import type { VisibleGraph } from './graphModel';

/** True when both graphs hold the same node objects and the same edge objects, in the same order. */
export function sameGraph(a: VisibleGraph, b: VisibleGraph): boolean {
    if (a === b) return true;
    if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
    for (let i = 0; i < a.nodes.length; i++) if (a.nodes[i] !== b.nodes[i]) return false;
    for (let i = 0; i < a.edges.length; i++) if (a.edges[i] !== b.edges[i]) return false;
    return true;
}

export function useStableGraph(next: VisibleGraph): VisibleGraph {
    const held = useRef(next);
    if (!sameGraph(held.current, next)) held.current = next;
    return held.current;
}

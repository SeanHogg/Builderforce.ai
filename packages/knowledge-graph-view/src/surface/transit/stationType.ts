/**
 * A station's mark type: an aggregate takes its members' dominant type (PRD 43 B1a rule 2), so a
 * folder of tests is a diamond and a folder of schemas a drum on the Map and in the Tower, exactly
 * as each file is in the Graph and 3D. Pure; the registry is `shapes.ts`.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex } from '../../graphModel';
import { dominantType, markTypeOf, type MarkType } from '../../shapes';
import type { StationModel } from '../stations';

/**
 * Station id → its members' dominant type; empty without a graph (the marks then keep their plain disc).
 * `index`: the graph's node index when the caller already holds one (it is not rebuilt).
 */
export function stationTypes(graph: Pick<KnowledgeGraph, 'nodes'> | null, model: Pick<StationModel, 'stations'>, index?: ReadonlyMap<string, KNode>): Map<string, MarkType> {
    const out = new Map<string, MarkType>();
    if (!graph) return out;
    index ??= nodeIndex(graph);
    for (const s of model.stations) {
        const types: MarkType[] = [];
        for (const ref of s.refs) { const n = index.get(ref); if (n) types.push(markTypeOf(n)); }
        out.set(s.id, dominantType(types));
    }
    return out;
}

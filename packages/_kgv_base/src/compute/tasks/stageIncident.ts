/**
 * The stage's ranked incident index (PRD 43 B5, B7 Selection), built once per resident graph and sent ONCE as typed
 * arrays, so selecting a slot slices its neighbours on the main thread with no worker trip:
 *
 *   `neighbours[offsets[s] .. offsets[s + 1])` are slot `s`'s neighbours, best first — by link weight (parallel edges
 *   summed), then the neighbour's importance, then the lower slot.
 *
 * A node slot's neighbours are the nodes its edges reach; a station slot's are the stations its members' edges reach
 * (weight = how many). Importance ties read the MarkSet's `importance`. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { StageModel } from './stageModel';

export interface SlotIncidentRaw {
    generation: number;
    offsets: Uint32Array;
    neighbours: Uint32Array;
    weight: Float32Array;
}

export function buildSlotIncident(g: KnowledgeGraph, model: Pick<StageModel, 'marks' | 'nodeSlot'>): SlotIncidentRaw {
    const n = model.marks.keys.length;
    // The MarkSet's importance: the same reading picking breaks ties with.
    const importance = model.marks.importance;

    // Every link as two directed pairs; a cross-station node link also links the two stations.
    const from: number[] = [], to: number[] = [], w: number[] = [];
    const add = (a: number, b: number, weight: number) => { from.push(a, b); to.push(b, a); w.push(weight, weight); };
    const station = model.marks.parentStation;
    for (const e of g.edges) {
        const a = model.nodeSlot.get(e.from), b = model.nodeSlot.get(e.to);
        if (a === undefined || b === undefined || a === b) continue;
        add(a, b, Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 1);
        const sa = station[a]!, sb = station[b]!;
        if (sa >= 0 && sb >= 0 && sa !== sb) add(sa, sb, 1);
    }

    // Bucket by source slot (CSR), then per slot merge parallel pairs and rank.
    const count = new Uint32Array(n + 1);
    for (const a of from) count[a + 1]!++;
    for (let s = 0; s < n; s++) count[s + 1]! += count[s]!;
    const at = count.slice(0, n);
    const order = new Uint32Array(from.length);
    for (let k = 0; k < from.length; k++) order[at[from[k]!]!++] = k;

    const offsets = new Uint32Array(n + 1);
    const neighbours: number[] = [], weight: number[] = [];
    for (let s = 0; s < n; s++) {
        const merged = new Map<number, number>();
        for (let k = count[s]!; k < count[s + 1]!; k++) { const e = order[k]!; merged.set(to[e]!, (merged.get(to[e]!) ?? 0) + w[e]!); }
        const ranked = [...merged].sort((x, y) => y[1] - x[1] || importance[y[0]]! - importance[x[0]]! || x[0] - y[0]);
        for (const [b, wt] of ranked) { neighbours.push(b); weight.push(wt); }
        offsets[s + 1] = neighbours.length;
    }
    return { generation: model.marks.generation, offsets, neighbours: Uint32Array.from(neighbours), weight: Float32Array.from(weight) };
}

/**
 * The Patterns drawer's matrix: pattern family by layer, counted in files, from the
 * comma-separated `patterns` badge (a heuristic over names, exports, imports and size). The
 * findings stand in as one more row, "Anti-pattern", counted by the layer of the station they
 * touch. Pure; the drawer only draws it.
 */

import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';
import { LAYER_ORDER } from '../layers';
import { stationOfRef, type StationModel } from '../stations';
import { OTHER_LAYER } from '../transitLayout';

export interface PatternFamily {
    id: string;
    /** File refs carrying the pattern. */
    refs: string[];
    /** Files per layer. */
    byLayer: Record<string, number>;
}

export interface PatternMatrix {
    families: PatternFamily[];
    /** Layers that hold any family or any finding, in layer order. */
    layers: string[];
    /** Findings per layer: the Anti-pattern row. */
    anti: Record<string, number>;
    antiTotal: number;
}

const layerName = (partition: string | undefined): string =>
    (LAYER_ORDER as readonly string[]).includes(partition ?? '') ? partition! : OTHER_LAYER;

/** The layer of a finding: that of the first node that lies in a station. */
export function findingLayer(f: Pick<Finding, 'nodes'>, model: Pick<StationModel, 'stationOf' | 'byId'>): string {
    for (const ref of f.nodes) {
        const station = model.byId.get(stationOfRef(model, ref) ?? '');
        if (station) return layerName(station.layer);
    }
    return OTHER_LAYER;
}

export function patternMatrix(graph: Pick<KnowledgeGraph, 'nodes' | 'findings'>, model: Pick<StationModel, 'stationOf' | 'byId'>): PatternMatrix {
    const families = new Map<string, PatternFamily>();
    for (const n of graph.nodes) {
        if (n.kind !== 'file') continue;
        const layer = layerName(n.partition);
        for (const raw of String(n.badges?.patterns ?? '').split(',')) {
            const id = raw.trim();
            if (!id) continue;
            const fam = families.get(id) ?? families.set(id, { id, refs: [], byLayer: {} }).get(id)!;
            fam.refs.push(n.ref);
            fam.byLayer[layer] = (fam.byLayer[layer] ?? 0) + 1;
        }
    }
    const anti: Record<string, number> = {};
    for (const f of graph.findings) { const l = findingLayer(f, model); anti[l] = (anti[l] ?? 0) + 1; }
    const used = new Set([...families.values()].flatMap((f) => Object.keys(f.byLayer)).concat(Object.keys(anti)));
    return {
        families: [...families.values()].sort((a, b) => b.refs.length - a.refs.length || cmp(a.id, b.id)),
        layers: [...LAYER_ORDER, OTHER_LAYER].filter((l) => used.has(l)),
        anti, antiTotal: graph.findings.length,
    };
}

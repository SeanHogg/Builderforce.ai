/**
 * What the stage's three tasks (`markSet`, `markPaint`, `placement`) share in the worker, per resident graph: the station
 * model and lines (the same `buildStations` / `buildLines` the surface task runs) and the MarkSet itself. Pinned per graph
 * (dropped with it), so the marks are built ONCE per graph (PRD 43 B1a rule 1) and paint and placement read the same slots.
 *
 * The replies are COPIES of the pinned arrays: a worker reply transfers its buffers, which would detach the pinned ones.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { buildLines, type LinesModel } from '../../surface/lines';
import { buildStations, type StationModel } from '../../surface/stations';
import type { ComputeStore } from '../store';
import type { GraphId } from '../protocol';
import type { MarkSet } from '../../stage/types';
import { buildMarkSet, stringsDigest } from './markSet';
import { emptyRegistry, type AppendedRegistry } from './placement/symbolSlots';

export interface StageModel {
    stations: StationModel;
    lines: LinesModel;
    marks: MarkSet;
    /** node ref → its slot (a node's slot is its index in `graph.nodes`). */
    nodeSlot: Map<string, number>;
    /** station id → its slot. */
    stationSlot: Map<string, number>;
    /** The localized words the markSet request carried (the worker has no labels object): folder root, placement names. */
    strings: Readonly<Record<string, string>>;
    /** The bands, top to bottom, when this is a drilled level's model (`placement/drill.ts`); absent = the architecture layers. */
    order?: readonly string[];
    /** The slots appended to this MarkSet so far, by key (`placement/symbolSlots.ts`); dies with the model, as the renderer's live keys reset with a new MarkSet. */
    appended: AppendedRegistry;
}

interface Held { changed: string; model: StageModel }

const changedKey = (changed: readonly string[]): string => [...changed].sort().join('\n');

/**
 * The stage model of a resident graph. A markSet request (`changed` and `strings`) rebuilds it when either differs from
 * the one held; paint and placement pass nothing and read whatever the last markSet built (or build it with no changes).
 */
export function stageModelOf(store: ComputeStore, graph: GraphId, changed?: readonly string[], strings: Readonly<Record<string, string>> = {}): StageModel {
    const held = store.pinned<{ value: Held | null }>(graph, 'stage', () => ({ value: null }));
    const key = changed ? `${changedKey(changed)}\n#${stringsDigest(strings)}` : held.value?.changed ?? '';
    if (held.value && held.value.changed === key) return held.value.model;
    const g = store.graph(graph);
    held.value = { changed: key, model: buildStageModel(g, changed ?? [], strings) };
    return held.value.model;
}

/** A MarkSet's generation: FNV-1a of what it was built from, never 0 (0 = no MarkSet). */
function generationOf(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0) || 1;
}

export function buildStageModel(g: KnowledgeGraph, changed: readonly string[], strings: Readonly<Record<string, string>> = {}): StageModel {
    const stations = buildStations(g, { changed: new Set(changed) });
    const lines = buildLines(g, stations);
    const marks = buildMarkSet(g, stations, 0, strings);
    // Deterministic: the same graph, changes and strings make the same generation in any realm (the worker, or the main
    // thread after a fail-over), so answers built there still match the marks on show.
    marks.generation = generationOf(`${marks.digest}\n${changedKey(changed)}`);
    const nodeSlot = new Map<string, number>();
    g.nodes.forEach((n, i) => nodeSlot.set(n.ref, i));
    const stationSlot = new Map<string, number>();
    const base = g.nodes.length;
    stations.stations.forEach((s, i) => stationSlot.set(s.id, base + i));
    return { stations, lines, marks, nodeSlot, stationSlot, strings, appended: emptyRegistry() };
}

/** A MarkSet whose typed arrays are copies (safe to transfer). */
export function copyMarkSet(m: MarkSet): MarkSet {
    return {
        ...m,
        keys: m.keys, label: m.label, tooltip: m.tooltip,
        slotKind: m.slotKind.slice(), type: m.type.slice(), importance: m.importance.slice(), parentStation: m.parentStation.slice(), parentFolder: m.parentFolder.slice(),
        batches: m.batches.map((b) => ({ type: b.type, slots: b.slots.slice() })),
    };
}

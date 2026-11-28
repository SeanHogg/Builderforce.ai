/**
 * A drilled level as a StageModel (its stations, lines and slots) plus what built it: the Map's level scene (`level.ts`) and
 * the Flow place the SAME level (`drill.ts` adds the class band's associations). Definitions the host loaded that the
 * resident graph does not hold become APPENDED slots, numbered by key through the ONE fold (`symbolSlots`) the Sequence uses.
 * A system or app frame has an empty view (the level scene draws those from `levelChildren`). Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { buildDrillView, type DrillFrame } from '../../../surface/transit/drillView';
import { fileNodesOf } from '../../../surface/outlineGraph';
import { withSymbolRecords } from '../../../surface/transit/symbols';
import type { SymbolRecord } from '../../../types';
import type { StageModel } from '../stageModel';
import { symbolSlots } from './symbolSlots';

export function drillLevel(g: KnowledgeGraph, model: StageModel, frame: Pick<DrillFrame, 'level' | 'ref'>, symbols: readonly SymbolRecord[]) {
    const enriched = withSymbolRecords(g, symbols);
    const view = buildDrillView(enriched, model.stations, { ...frame, name: '' } as DrillFrame, symbols);
    const missing = new Set(view.stations.stations.filter((station) => !view.leaves.has(station.id)).flatMap((station) => station.refs)
        .filter((ref) => !model.nodeSlot.has(ref)));
    const files = missing.size ? fileNodesOf(g).filter((node) => missing.has(node.ref)) : [];
    const full = files.length ? { ...enriched, nodes: [...enriched.nodes, ...files] } : enriched;
    const { marks, append, nodeSlot } = symbolSlots(model, full, g.nodes.length);

    const stationSlot = new Map<string, number>();
    for (const s of view.stations.stations) {
        const slot = view.leaves.has(s.id) ? model.stationSlot.get(s.id) : nodeSlot.get(s.refs[0] ?? '');
        if (slot !== undefined) stationSlot.set(s.id, slot);
    }
    const level: StageModel = { ...model, stations: view.stations, lines: view.lines, marks, nodeSlot, stationSlot, order: view.order };
    return { level, view, full, append, stationSlot };
}

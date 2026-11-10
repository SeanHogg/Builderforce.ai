/**
 * A drilled level as a placement of the SAME marks (PRD 43 B7: drill enter / exit; B1a rules 1, 4). The level is the
 * map's own `buildDrillView` (package → its files, class → a file's symbols, function → a symbol and its callees),
 * placed exactly like the world map (`placeMap`) over the level's stations and lines — ONE model, so the layout and the
 * lines can never disagree (the old Go-inside crash was a layout of one level drawn with another level's lines).
 *
 * Every level station is keyed by SLOT: a member by its node's slot, a neighbour (leaf) by its world station's slot.
 * Definitions the host loaded (`req.symbols`) that the resident graph does not hold become APPENDED slots after the
 * MarkSet's — in record order, which is append-only, so an appended symbol keeps its slot from request to request — and
 * travel with the placement (`append`) for the stage to add into its headroom. Everything not in the level is hidden at
 * its anchor (scale 0), so entering grows the members out of their station and going out collapses them back. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { importanceOf } from '../../../order';
import { markTypeOf } from '../../../shapes';
import { withAppended } from '../../../stage/drill/appended';
import { fileRefOf, stationOfRef } from '../../../surface/stations';
import { buildDrillView, type DrillFrame } from '../../../surface/transit/drillView';
import { withSymbolRecords } from '../../../surface/transit/symbols';
import { SLOT_NODE, type MarkSet, type Placement, type SlotAppend } from '../../../stage/types';
import { typeIndex } from '../markSet';
import type { StageModel } from '../stageModel';
import { placeMap } from './map';
import { drillFrameOf, type PlacementReq } from './request';

export function placeDrill(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const frame = drillFrameOf(req.drill);
    if (!frame) return placeMap(model, { ...req, drill: null });
    const full = withSymbolRecords(g, req.symbols ?? []);
    const { marks, append, nodeSlot } = extendedMarks(model, full, g.nodes.length);
    const view = buildDrillView(full, model.stations, { ...frame, name: '' } as DrillFrame);

    const stationSlot = new Map<string, number>();
    for (const s of view.stations.stations) {
        const slot = view.leaves.has(s.id) ? model.stationSlot.get(s.id) : nodeSlot.get(s.refs[0] ?? '');
        if (slot !== undefined) stationSlot.set(s.id, slot);
    }
    const level: StageModel = { ...model, stations: view.stations, lines: view.lines, marks, nodeSlot, stationSlot, order: view.order };
    return { ...placeMap(level, req), ...(append ? { append } : {}) };
}

/** The MarkSet with the loaded definitions the graph lacks appended (their forest: the station and folder of their file). */
function extendedMarks(model: StageModel, full: KnowledgeGraph, graphNodes: number): { marks: MarkSet; append: SlotAppend | null; nodeSlot: Map<string, number> } {
    const extra = full.nodes.slice(graphNodes);
    if (extra.length === 0) return { marks: model.marks, append: null, nodeSlot: model.nodeSlot };
    const m = model.marks, base = m.keys.length, k = extra.length;
    const append: SlotAppend = {
        base, keys: [], label: [], tooltip: [], importance: new Float32Array(k),
        type: new Uint8Array(k), slotKind: new Uint8Array(k).fill(SLOT_NODE), parentStation: new Int32Array(k).fill(-1), parentFolder: new Int32Array(k).fill(-1),
    };
    const nodeSlot = new Map(model.nodeSlot);
    extra.forEach((node, i) => {
        nodeSlot.set(node.ref, base + i);
        append.keys.push(`node:${node.ref}`); append.label.push(node.label); append.tooltip.push(node.ref);
        append.type[i] = typeIndex(markTypeOf(node)); append.importance[i] = importanceOf(node);
        const file = fileRefOf(node.ref);
        const station = stationOfRef(model.stations, file);
        append.parentStation[i] = station === undefined ? -1 : model.stationSlot.get(station) ?? -1;
        const fileSlot = model.nodeSlot.get(file);
        append.parentFolder[i] = fileSlot === undefined ? -1 : m.parentFolder[fileSlot] ?? -1;
    });
    // The ONE fold of a run into a MarkSet (the renderer's overflow rebuild uses it too).
    return { marks: withAppended(m, append), append, nodeSlot };
}

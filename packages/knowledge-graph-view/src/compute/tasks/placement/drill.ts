/**
 * A drilled level as a placement of the SAME marks (PRD 43 B7: drill enter / exit; B1a rules 1, 4). The level is the
 * map's own `buildDrillView` (package → its files, class → a file's symbols, function → a symbol and its callees),
 * placed exactly like the world map (`placeMap`) over the level's stations and lines — ONE model, so the layout and the
 * lines can never disagree (the old Go-inside crash was a layout of one level drawn with another level's lines).
 *
 * Every level station is keyed by SLOT: a member by its node's slot, a neighbour (leaf) by its world station's slot.
 * Definitions the host loaded (`req.symbols`) that the resident graph does not hold become APPENDED slots after the
 * MarkSet's, numbered by key through the ONE fold (`symbolSlots`) the Sequence uses too, and travel with the placement
 * (`append`) for the stage to add into its headroom. Everything not in the level is hidden at its anchor (scale 0), so
 * entering grows the members out of their station and going out collapses them back.
 *
 * The level's composition / association links (`extends`, `implements`, `composes`, `uses` from the loaded records'
 * relations) are one more batch between its members (`associations.ts`). A zoom-entered level is nested into its parent
 * mark on the main thread (`stage/drill/nest.ts`), so the zoom stays continuous.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { buildDrillView, type DrillFrame } from '../../../surface/transit/drillView';
import { withSymbolRecords } from '../../../surface/transit/symbols';
import type { Placement } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { associationLinks } from './associations';
import { placeMap } from './map';
import { drillFrameOf, type PlacementReq } from './request';
import { symbolSlots } from './symbolSlots';

export function placeDrill(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const frame = drillFrameOf(req.drill);
    if (!frame) return placeMap(model, { ...req, drill: null });
    const full = withSymbolRecords(g, req.symbols ?? []);
    const { marks, append, nodeSlot } = symbolSlots(model, full, g.nodes.length);
    const view = buildDrillView(full, model.stations, { ...frame, name: '' } as DrillFrame);

    const stationSlot = new Map<string, number>();
    for (const s of view.stations.stations) {
        const slot = view.leaves.has(s.id) ? model.stationSlot.get(s.id) : nodeSlot.get(s.refs[0] ?? '');
        if (slot !== undefined) stationSlot.set(s.id, slot);
    }
    const level: StageModel = { ...model, stations: view.stations, lines: view.lines, marks, nodeSlot, stationSlot, order: view.order };
    const placed = placeMap(level, req);
    // The level's members by the ref they draw (a file at the class band, a symbol at the method band): the association
    // links land on them (B1a rule 9).
    const slotOfRef = new Map<string, number>();
    for (const s of view.stations.stations) {
        const slot = stationSlot.get(s.id), ref = s.refs[0];
        if (slot !== undefined && ref !== undefined && !view.leaves.has(s.id)) slotOfRef.set(ref, slot);
    }
    const associations = associationLinks(placed, req.symbols ?? [], slotOfRef);
    return { ...placed, ...(associations ? { links: [...placed.links, associations] } : {}), ...(append ? { append } : {}) };
}

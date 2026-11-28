/**
 * A drilled level as a placement of the SAME marks (PRD 43 B7: drill enter / exit; B1a rules 1, 4). The Map and 3D cameras
 * place every level, drilled or not, through the level scene (`level.ts`: one level at a time, the design's shapes). The
 * other cameras place the level the map's own `buildDrillView` (`drillLevel.ts`: package → its files, class → a file's
 * symbols, function → a symbol and its callees) builds, exactly like the transit map (`placeMap`) over the level's stations
 * and lines — ONE model, so the layout and the lines can never disagree.
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
import type { Placement } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { associationLinks } from './associations';
import { drillLevel } from './drillLevel';
import { placeLevel } from './level';
import { placeMap } from './map';
import { drillFrameOf, type PlacementReq } from './request';

/** The cameras that draw one level at a time (`level.ts`), drilled or not. */
export const isLevelCamera = (camera: PlacementReq['camera']): boolean => camera === 'map' || camera === '3d';

export function placeDrill(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    if (isLevelCamera(req.camera)) return placeLevel(g, model, req);
    const frame = drillFrameOf(req.drill);
    if (!frame) return placeMap(model, { ...req, drill: null });
    const { level, view, append, stationSlot } = drillLevel(g, model, frame, req.symbols ?? []);
    const placed = placeMap(level, req);
    // The level's members by the ref they draw (a file at the class band, a symbol at the method band): the association
    // links land on them (B1a rule 9).
    const slotOfRef = new Map<string, number>();
    for (const s of view.stations.stations) {
        const slot = stationSlot.get(s.id), ref = s.refs[0];
        if (slot !== undefined && ref !== undefined && !view.leaves.has(s.id)) slotOfRef.set(ref, slot);
    }
    const associations = associationLinks(placed, req.symbols ?? [], slotOfRef);
    // The level's NEIGHBOURS (the world stations drawn as leaves) are outside it: ghosts, drawn at 0.62.
    const ghost = new Uint8Array(placed.scale.length);
    let ghosts = 0;
    for (const id of view.leaves) { const slot = stationSlot.get(id); if (slot !== undefined && placed.scale[slot]! > 0) { ghost[slot] = 1; ghosts++; } }
    return { ...placed, ...(associations ? { links: [...placed.links, associations] } : {}), ...(append ? { append } : {}), ...(ghosts ? { ghost } : {}) };
}

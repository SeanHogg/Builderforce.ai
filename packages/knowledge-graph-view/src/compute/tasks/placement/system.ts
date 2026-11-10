/**
 * The System placement (PRD 43 B1a rule 8): the System camera's tiers as planes of the SAME station marks. It reads the
 * DOM camera's own model — `buildSystemGroups` / `buildSystemLayout`, unchanged — so the grouping cannot drift: one
 * section per system (a multi-system root), each a plane per tier (its first `MAX_PER_TIER` stations, "+N more" for
 * the rest), then the data stores and external services as the last plane. Stations in no layer and on no line stay
 * hidden (the DOM camera only counts them). Marks: radius = the size channel; tilt extrudes each into its tower. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { bandTitleIn } from '../../../surface/bands';
import { makeOverlay } from '../../../surface/overlays';
import { buildSystemGroups } from '../../../surface/system/systemGroups';
import { buildSystemLayout, type SystemLayout } from '../../../surface/system/systemModel';
import type { Placement } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { draftFor } from './anchor';
import { CAMERA_WORD, wordIn } from './cameraStrings';
import { channelBindings, type PlacementReq } from './request';
import { depthOf, layoutRows, rowsPlacement, stationItem, type Row, type RowItem, type Section } from './rows';

export const SYSTEM_METRICS = { pitch: 72, margin: 16 } as const;

export function placeSystem(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const { stations, lines, strings } = model;
    const overlay = makeOverlay(channelBindings(req.channels), stations.stations);
    const depth = depthOf(req);
    const item = (id: string): RowItem[] => { const s = stations.byId.get(id); const it = s ? stationItem(model, overlay, depth, s) : null; return it ? [it] : []; };
    const rowsOf = (layout: SystemLayout, prefix: string): Row[] => [
        ...layout.tiers.map((t): Row => ({ key: `${prefix}${t.layer}`, title: bandTitleIn(strings, t.layer), items: t.shown.flatMap((s) => item(s.id)), more: t.hidden })),
        ...(layout.stores.length > 0 ? [{ key: `${prefix}stores`, title: wordIn(strings, CAMERA_WORD.systemData), items: layout.stores.flatMap((t) => item(t.stationId)) }] : []),
    ];
    const groups = buildSystemGroups(stations, lines, g);
    const sections: Section[] = groups.length === 0
        ? [{ key: '', title: null, rows: rowsOf(buildSystemLayout(stations, lines, g), '') }]
        : groups.map((gr) => ({ key: gr.system, title: gr.name || wordIn(strings, CAMERA_WORD.systemLoose), rows: rowsOf(gr.layout, `${gr.system}/`) }));
    const d = draftFor(model.marks.keys.length);
    const rows = layoutRows(d, sections, req, strings, SYSTEM_METRICS);
    return rowsPlacement(model, req, d, rows, stations.stations.length);
}

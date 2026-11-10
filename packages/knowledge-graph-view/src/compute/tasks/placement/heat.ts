/**
 * The Heat placement (PRD 43 B1a rule 8; B2: height = heat): the Heat camera's grid as planes of the SAME station marks
 * — one plane per tier (`buildTiers`, the grouping the DOM `HeatGrid` reads), the first `HEAT_CELL_CAP` stations in
 * tier order, the rest counted ("+N more"). The metric is geometry plus paint, never per-camera rendering: a mark's
 * radius is the size channel and tilting extrudes it to its height (`towerHeight` of that channel); its colour is the
 * colour channel, painted by `markPaint` like every camera. Pure.
 */

import { bandTitleIn } from '../../../surface/bands';
import { HEAT_CELL_CAP } from '../../../surface/heatCells';
import { makeOverlay } from '../../../surface/overlays';
import { buildTiers } from '../../../surface/tiers';
import type { Placement } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { draftFor } from './anchor';
import { channelBindings, type PlacementReq } from './request';
import { depthOf, layoutRows, rowsPlacement, stationItem, type Row } from './rows';

export const HEAT_METRICS = { pitch: 56, margin: 16 } as const;

export function placeHeat(model: StageModel, req: PlacementReq): Placement {
    const { stations, strings } = model;
    const overlay = makeOverlay(channelBindings(req.channels), stations.stations);
    const depth = depthOf(req);
    let budget = HEAT_CELL_CAP;
    const rows: Row[] = buildTiers(stations.stations).flatMap((tier) => {
        const cells = tier.stations.slice(0, Math.max(0, budget));
        budget -= cells.length;
        if (cells.length === 0) return [];
        return [{ key: tier.layer, title: bandTitleIn(strings, tier.layer), items: cells.flatMap((s) => stationItem(model, overlay, depth, s) ?? []) }];
    });
    // The cells past the cap are counted once, after the last row (the DOM grid's "N more").
    const hidden = Math.max(0, stations.stations.length - (HEAT_CELL_CAP - Math.max(0, budget)));
    if (hidden > 0 && rows.length > 0) rows[rows.length - 1] = { ...rows[rows.length - 1]!, more: hidden };
    const d = draftFor(model.marks.keys.length);
    const out = layoutRows(d, [{ key: '', title: null, rows }], req, strings, HEAT_METRICS);
    return rowsPlacement(model, req, d, out, stations.stations.length);
}

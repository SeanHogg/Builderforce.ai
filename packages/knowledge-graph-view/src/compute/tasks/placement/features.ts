/**
 * The Features placement (PRD 43 B1a rule 8): the Key features camera's five groups as planes of the SAME marks. It
 * reads `keyFeaturesOf` unchanged, so the groups and their ranking cannot drift: a feature that names a file shows that
 * file's mark, one that names a station shows the station's; a group cut at `FEATURE_CAP` says "+N more". A mark that
 * two groups name stays in the first (a slot is shown once). Station radius = the size channel; a file's = its
 * importance. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeRadius } from '../../../graph2d/layout2d';
import { importanceOf } from '../../../order';
import { FEATURE_GROUPS, keyFeaturesOf, type Feature } from '../../../surface/features/keyFeatures';
import { makeOverlay } from '../../../surface/overlays';
import type { Placement } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { draftFor } from './anchor';
import { featureGroupKey, wordIn } from './cameraStrings';
import { channelBindings, type PlacementReq } from './request';
import { depthOf, layoutRows, rowsPlacement, stationItem, type Row, type RowItem } from './rows';
import { FILE_SCALE } from './style';

export const FEATURES_METRICS = { pitch: 64, margin: 16 } as const;

export function placeFeatures(g: KnowledgeGraph, model: StageModel, req: PlacementReq): Placement {
    const { stations, strings } = model;
    const overlay = makeOverlay(channelBindings(req.channels), stations.stations);
    const depth = depthOf(req);
    const features = keyFeaturesOf(g, stations);
    const item = (f: Feature): RowItem | null => {
        const slot = f.ref !== undefined ? model.nodeSlot.get(f.ref) : undefined;
        if (slot !== undefined) return { slot, scale: FILE_SCALE * nodeRadius(importanceOf(g.nodes[slot]!)), label: f.label, a11y: f.detail ?? f.label, priority: f.count };
        const s = f.stationId !== undefined ? stations.byId.get(f.stationId) : undefined;
        const it = s ? stationItem(model, overlay, depth, s) : null;
        return it ? { ...it, label: f.label } : null;
    };
    const rows: Row[] = FEATURE_GROUPS.map((group) => {
        const list = features[group];
        return { key: group, title: wordIn(strings, featureGroupKey(group)), items: list.items.flatMap((f) => item(f) ?? []), more: list.total - list.items.length };
    });
    const d = draftFor(model.marks.keys.length);
    const out = layoutRows(d, [{ key: '', title: null, rows }], req, strings, FEATURES_METRICS);
    const total = FEATURE_GROUPS.reduce((sum, group) => sum + features[group].total, 0);
    return rowsPlacement(model, req, d, out, total);
}

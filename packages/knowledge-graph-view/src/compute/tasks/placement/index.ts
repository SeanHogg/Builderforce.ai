/**
 * The placement registry (PRD 43 B1a rule 4): camera → the pure task that lays the ONE MarkSet out for it. A new camera
 * is a row here (and its `PlacementCamera` name), never a branch in the stage.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { IdleTask } from '../../../useIdleSteps';
import type { Placement, PlacementCamera } from '../../../stage/types';
import { once } from '../handler';
import type { StageModel } from '../stageModel';
import { placeGraph } from './graph';
import { placeMap } from './map';
import { placeMind } from './mindmap';
import { placeSequence } from './sequence';
import type { PlacementReq } from './request';
import { placeScene3d } from './scene3d';
import { placeFeatures } from './features';
import { placeHeat } from './heat';
import { placeStyle } from './style';
import { placeSystem } from './system';

export type PlacementBuilder = (g: KnowledgeGraph, model: StageModel, req: PlacementReq) => IdleTask<Placement>;

export const PLACEMENTS: Readonly<Record<PlacementCamera, PlacementBuilder>> = {
    map: (_g, model, req) => once(() => placeMap(model, req)),
    graph: placeGraph,
    '3d': placeScene3d,
    mind: (g, model, req) => once(() => placeMind(g, model, req)),
    sequence: (g, model, req) => once(() => placeSequence(g, model, req)),
    system: (g, model, req) => once(() => placeSystem(g, model, req)),
    heat: (_g, model, req) => once(() => placeHeat(model, req)),
    style: (g, model, req) => once(() => placeStyle(g, model, req)),
    features: (g, model, req) => once(() => placeFeatures(g, model, req)),
};

export { VIEWPORT_BANDS, viewportBandOf, placementCacheKey, type PlacementReq } from './request';

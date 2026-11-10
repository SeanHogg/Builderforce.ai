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
import type { PlacementReq } from './request';

export type PlacementBuilder = (g: KnowledgeGraph, model: StageModel, req: PlacementReq) => IdleTask<Placement>;

export const PLACEMENTS: Readonly<Record<PlacementCamera, PlacementBuilder>> = {
    map: (_g, model, req) => once(() => placeMap(model, req)),
    graph: placeGraph,
};

export { VIEWPORT_BANDS, viewportBandOf, placementCacheKey, type PlacementReq } from './request';

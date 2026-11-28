/**
 * The placement request the host asks the worker for (`StageHost.tsx`): what each camera reads of the host's state. The world,
 * a system and an app are drawn from the stations (hidden ones are left out, Map and 3D only); only a package or deeper reads
 * the loaded symbols (the Sequence and a Graph path read them too). A field a camera does not read is left out of the
 * request, so it is not part of the placement's key either.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { drillFrameOf, type PlacementReq } from '../../compute/tasks/placement/request';
import { isStructuralLevel } from '../../surface/transit/levelFrames';
import type { PlacementCamera } from '../types';

/** What the host holds that a request is built from. */
export type PlaceInputs = Pick<PlacementReq, 'generation' | 'viewportBand' | 'channels' | 'symbols'> & { graph: KnowledgeGraph; hiddenStations: readonly string[] };
/** The request as the compute hook takes it: `PlacementReq` with the resident graph in place of its id (the codec swaps it). */
export type PlaceRequest = Omit<PlacementReq, 'graph'> & { graph: KnowledgeGraph };

export function placementReqOf(i: PlaceInputs, camera: PlacementCamera, depth: number | undefined, drill: string | null, lod: number, pathId: string | null, method: string | null = null): PlaceRequest {
    const structural = isStructuralLevel(drillFrameOf(drill)?.level ?? 'world');
    return {
        graph: i.graph, generation: i.generation, camera, drill, unfolded: null, pins: [], pathId, viewportBand: i.viewportBand, lod, channels: i.channels,
        ...(depth === undefined ? {} : { depth }),
        ...(method ? { method } : {}),
        ...((camera === 'map' || camera === '3d') && structural && i.hiddenStations.length ? { hiddenStations: i.hiddenStations } : {}),
        ...((drill && !structural) || camera === 'sequence' || (camera === 'graph' && pathId) ? { symbols: i.symbols } : {}),
    };
}

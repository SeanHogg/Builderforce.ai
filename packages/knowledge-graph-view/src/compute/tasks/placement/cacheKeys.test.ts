import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { bandStrings } from '../../../surface/bands';
import { homeKeyOf } from '../../../stage/rig/useRig';
import type { PlacementCamera } from '../../../stage/types';
import { surfaceFixture } from '../../../testing';
import { withSymbols } from '../../../surface/transit/testFixtures';
import { ComputeClient } from '../../client';
import { FakeWorker, flush } from '../../testKit';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS } from './index';
import { placementCacheKey, type PlacementReq } from './request';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
const req = (camera: PlacementCamera): PlacementReq => ({ graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });

describe('every camera stamps the ONE cache key (B1a rule 6)', () => {
    it.each(Object.keys(PLACEMENTS) as PlacementCamera[])('%s: cacheKey = placementCacheKey(generation, req), and the rig reads its camera from it', (camera) => {
        const r = req(camera);
        const t = PLACEMENTS[camera](graph, model, r);
        while (!t.step());
        const p = t.result();
        expect(p.cacheKey).toBe(placementCacheKey(String(r.generation), r));
        expect(homeKeyOf(p).split('|')[0]).toBe(camera);
    });
});

describe('a worker fail-over keeps the stage showing (requests carry the model inputs; generations are deterministic)', () => {
    beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('after the worker dies, the main thread answers paint and placement for the SAME MarkSet generation the worker built', async () => {
        const workers: FakeWorker[] = [];
        const client = new ComputeClient(() => { const w = new FakeWorker(); workers.push(w); return w; });
        const strings = Object.fromEntries(Object.entries(bandStrings(L)).map(([k, v]) => [k, `Domaine:${v}`]));
        // The MarkSet the worker built (the deterministic generation the main thread will rebuild too).
        const built = buildStageModel(graph, [], strings).marks;
        const marksDone = vi.fn();
        client.run('markSet', { graph, changed: [], strings }, { done: marksDone, fail: vi.fn() });
        await flush();
        const worker = workers[0]!;
        worker.done(worker.runs()[0]!, built);
        await flush();
        expect(marksDone).toHaveBeenCalled();

        const placed = vi.fn();
        client.run('placement', { ...req('map'), graph, generation: built.generation }, { done: placed, fail: vi.fn() });
        await flush();
        expect((worker.runs()[1]!.req as { model?: unknown }).model).toEqual({ changed: [], strings });   // the codec carried the inputs
        worker.onerror?.({} as never);                                   // the worker dies with the placement owed
        await vi.waitFor(() => expect(placed).toHaveBeenCalled(), { timeout: 5000 });
        const p = placed.mock.calls[0]![0] as { generation: number; captions: { text: string }[] };
        expect(p.generation).toBe(built.generation);                     // still matches the marks on show
        expect(p.captions.length).toBeGreaterThan(0);
        expect(p.captions.every((c) => c.text.startsWith('Domaine:'))).toBe(true); // built with the same localized strings
    });
});

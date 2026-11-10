import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeClient } from './client';
import { placementCacheKey } from './tasks/placement/request';
import { FakeWorker, flush, makeGraph } from './testKit';
import type { KindInput } from './kinds';

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the placement cache (PRD 43 B1a rule 6: a return trip is a buffer swap, no worker call)', () => {
    it('drill in, Out, in again: the second "in" is answered from the cache; a locale change (a new MarkSet build) misses', async () => {
        const workers: FakeWorker[] = [];
        const client = new ComputeClient(() => { const w = new FakeWorker(); workers.push(w); return w; });
        const worker = () => workers[workers.length - 1]!;
        const graph = makeGraph(4);
        const req = (generation: number, drill: string | null): KindInput<'placement'> => ({
            graph, generation, camera: 'map', drill, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0,
        });
        // The worker stamps each answer with its own key (what a placement builder does): the cache stores it under that.
        const answer = (r: KindInput<'placement'>) => ({ cacheKey: placementCacheKey(String(r.generation), { ...r, graph: 0 }), tag: r.drill ?? 'world' });
        const ask = async (r: KindInput<'placement'>) => {
            const done = vi.fn();
            client.run('placement', r, { done, fail: vi.fn() });
            await flush();
            return done;
        };
        const reply = async (r: KindInput<'placement'>) => { const runs = worker().runs(); worker().done(runs[runs.length - 1]!, answer(r)); await flush(); };

        const inside = req(7, 'package:api'), world = req(7, null);
        const first = await ask(inside); await reply(inside);
        expect(first).toHaveBeenCalledWith(expect.objectContaining({ tag: 'package:api' }));
        await ask(world); await reply(world);
        expect(worker().runs()).toHaveLength(2);

        const again = await ask(inside);
        expect(worker().runs()).toHaveLength(2);                   // no worker call for the return trip
        expect(again).toHaveBeenCalledWith(expect.objectContaining({ tag: 'package:api' }));
        expect(worker().runs().filter((r) => (r.req as { drill: string | null }).drill === 'package:api')).toHaveLength(1);

        // A locale change rebuilds the MarkSet under a new generation (its build key carries the strings digest): a miss.
        await ask(req(8, 'package:api'));
        expect(worker().runs()).toHaveLength(3);
    });
});

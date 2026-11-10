/** The Key features model over the surface fixture: every group read from an existing model, ranked, capped and deterministic. */
import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { FEATURE_CAP, keyFeaturesOf } from './keyFeatures';

const graph = surfaceFixture();
const model = buildStations(graph);
const ref = (path: string) => `src:sys::${path}`;

describe('keyFeaturesOf', () => {
    const f = keyFeaturesOf(graph, model);

    it('lists the routes as endpoints, with the file that registers them', () => {
        expect(f.endpoints.items.map((e) => e.label).sort()).toEqual(['GET /users/:id', 'POST /users']);
        expect(f.endpoints.items.every((e) => e.ref === ref('api/routes.ts'))).toBe(true);
    });

    it('lists the entry-layer source files, most important first', () => {
        expect(f.entryPoints.items.map((e) => e.ref)).toEqual([ref('web/main.tsx'), ref('cron/job.ts')]);
    });

    it('counts the patterns in use and ranks the most depended-on files by their dependents', () => {
        expect(f.patterns.items.map((p) => [p.label, p.count])).toEqual([['adapter', 1], ['repository', 1]]);
        expect(f.core.items[0]).toMatchObject({ ref: ref('api/useCase.ts'), count: 2 });
    });

    it('names the capabilities by station, each selecting its station', () => {
        expect(f.capabilities.total).toBe(model.stations.length);
        expect(f.capabilities.items.every((c) => c.stationId && model.byId.has(c.stationId))).toBe(true);
    });

    it('caps a group and keeps its full count', () => {
        for (const list of Object.values(f)) expect(list.items.length).toBeLessThanOrEqual(FEATURE_CAP);
        expect(f.endpoints.total).toBe(2);
    });

    it('reads equal graphs equally, whatever the input order', () => {
        const reversed = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
        expect(keyFeaturesOf(reversed, buildStations(reversed))).toEqual(f);
    });
});

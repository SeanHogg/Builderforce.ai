import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { curlOf, endpointsOf, groupByFile, openApiSkeleton, parseRoutes, postmanCollection, toOpenApiPath } from './apiModel';
import { coverageModel, MAX_GAPS } from './coverageModel';
import { patternMatrix } from './patternsModel';
import { formatBytes } from '../../formatBytes';

const graph = surfaceFixture();
const model = buildStations(graph);
const bare = { ...graph, nodes: graph.nodes.map(({ badges, ...n }) => (badges ? { ...n, badges: Object.fromEntries(Object.entries(badges).filter(([k]) => k !== 'coverage')) } : n)) };

describe('coverageModel', () => {
    it('reads the file badges: counts, the mean and the riskiest gaps', () => {
        const m = coverageModel(graph);
        expect(m.files).toBe(6);
        expect(m.withCoverage).toBe(2);
        expect(m.meanCoverage).toBeCloseTo(0.5);
        expect(m.totalComplexity).toBe(47);
        expect(m.gaps.map((g) => g.name)).toEqual(['db/repo.ts']);
        expect(m.points).toHaveLength(2);
    });
    it('reports no coverage, not zero, when no file has the badge', () => {
        const m = coverageModel(bare);
        expect(m.withCoverage).toBe(0);
        expect(m.meanCoverage).toBeUndefined();
        expect(m.gaps).toEqual([]);
    });
    it('caps the gap list but counts them all', () => {
        const many = Array.from({ length: MAX_GAPS + 5 }, (_, i) => ({ ...graph.nodes.find((n) => n.label === 'db/repo.ts')!, ref: `src:sys::x${i}.ts` as const }));
        const m = coverageModel({ nodes: many });
        expect(m.gaps).toHaveLength(MAX_GAPS);
        expect(m.gapCount).toBe(MAX_GAPS + 5);
    });
});

describe('patternMatrix', () => {
    it('counts files per family and layer, and the findings as the Anti-pattern row', () => {
        const m = patternMatrix(graph, model);
        expect(m.families.map((f) => f.id)).toEqual(['adapter', 'repository']);
        expect(m.families[0]!.byLayer).toEqual({ application: 1 });
        expect(m.antiTotal).toBe(2);
        expect(Object.values(m.anti).reduce((a, b) => a + b, 0)).toBe(2);
        expect(m.layers).toContain('application');
    });
    it('has no families when the badge is absent', () => {
        const none = patternMatrix({ nodes: [], findings: [] }, model);
        expect(none.families).toEqual([]);
    });
});

describe('apiModel', () => {
    it('parses METHOD path entries and drops the rest', () => {
        expect(parseRoutes('GET /a;POST /b/:id; nonsense ;get /c')).toEqual([{ method: 'GET', path: '/a' }, { method: 'POST', path: '/b/:id' }, { method: 'GET', path: '/c' }]);
        expect(parseRoutes(undefined)).toEqual([]);
    });
    it('lists endpoints with their callers, all undocumented without an OpenAPI document', () => {
        const eps = endpointsOf(graph, model);
        expect(eps.map((e) => `${e.method} ${e.path}`)).toEqual(['POST /users', 'GET /users/:id']);
        expect(eps.every((e) => !e.documented)).toBe(true);
        expect(eps[1]!.callers).toEqual(['Web app']);
        expect(groupByFile(eps)).toHaveLength(1);
    });
    it('marks an endpoint documented only when a node inside an OpenAPI document names its path', () => {
        // graph.nodes[0] is an area; an OpenAPI document is a file, and its sections are nodes inside it.
        const doc = { ...graph.nodes[0]!, ref: 'src:sys::openapi.yaml' as const, kind: 'file' as const, label: 'openapi.yaml' };
        const section = { ...graph.nodes[0]!, ref: 'src:sys::openapi.yaml#users' as const, kind: 'section' as const, label: 'GET /users/{id}' };
        const eps = endpointsOf({ nodes: [...graph.nodes, doc, section], edges: graph.edges }, model);
        expect(eps.find((e) => e.path === '/users/:id')!.documented).toBe(true);
        expect(eps.find((e) => e.path === '/users')!.documented).toBe(false);
    });
    it('builds a curl, an OpenAPI skeleton and a Postman collection from the routes', () => {
        const routes = [{ method: 'GET', path: '/users/:id' }, { method: 'POST', path: '/users' }];
        expect(curlOf(routes[1]!)).toBe(`curl -X POST "$BASE_URL/users" -H 'Content-Type: application/json' -d '{}'`);
        expect(toOpenApiPath('/a/:id/b/:n')).toBe('/a/{id}/b/{n}');
        const spec = openApiSkeleton(routes, 'sys');
        expect(spec.openapi).toBe('3.0.3');
        expect(Object.keys(spec.paths)).toEqual(['/users/{id}', '/users']);
        expect(JSON.stringify(spec.paths['/users/{id}']!.get)).toContain('"name":"id"');
        const pm = postmanCollection(routes, 'sys') as { item: Array<{ name: string; request: { url: { raw: string } } }> };
        expect(pm.item.map((i) => i.request.url.raw)).toEqual(['{{baseUrl}}/users/:id', '{{baseUrl}}/users']);
    });
});

describe('formatBytes', () => {
    it('formats sizes in words', () => {
        expect([formatBytes(12), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual(['12 B', '2.0 KB', '3.0 MB']);
    });
});

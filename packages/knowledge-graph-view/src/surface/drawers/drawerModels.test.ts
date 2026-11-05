import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { curlOf, endpointsOf, groupByFile, openApiSkeleton, parseRoutes, postmanCollection, toOpenApiPath } from './apiModel';
import { coverageModel, MAX_GAPS } from './coverageModel';
import { patternMatrix, topAntiPatterns } from './patternsModel';
import { formatBytes, pipelineSteps, serverShare } from './syncModel';

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
    it('has no families when the badge is absent, and lists worst findings first', () => {
        const none = patternMatrix({ nodes: [], findings: [] }, model);
        expect(none.families).toEqual([]);
        expect(topAntiPatterns(graph.findings)[0]!.severity).toBe('error');
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

describe('syncModel', () => {
    const counts = { files: 10, edges: 20, docs: 2 };
    const status = { local: counts, server: counts, skipped: [], sources: [{ id: 'code' as const, state: 'collected' as const }] };
    it('derives the six steps from what the host reported', () => {
        expect(pipelineSteps(status).map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
        const worse = pipelineSteps({ ...status, server: { ...counts, files: 7 }, skipped: [{ path: 'a', bytes: 1, reason: 'big' }], sources: [{ id: 'coverage', state: 'absent' }, { id: 'code', state: 'collected' }] });
        expect(Object.fromEntries(worse.map((s) => [s.id, s.state]))).toMatchObject({ match: 'attention', skipped: 'attention', analyse: 'attention' });
        const fresh = pipelineSteps({ local: { files: 0, edges: 0, docs: 0 }, skipped: [], sources: [] });
        expect(fresh.filter((s) => s.state === 'pending').map((s) => s.id)).toEqual(['walk', 'graph', 'upload', 'match', 'analyse']);
    });
    it('never reads an unmeasured count or an unrecorded skip list as a match or as "nothing skipped"', () => {
        const linked = { local: { files: 10, docs: 2 }, server: { files: 10, edges: 99, docs: 2 }, sources: [] };
        const steps = Object.fromEntries(pipelineSteps(linked).map((s) => [s.id, s.state]));
        expect(steps.match).toBe('ok'); // edges were not measured locally: only the measured counts are compared
        expect(steps.skipped).toBe('pending'); // skipped absent = unknown, not ok
        const cut = pipelineSteps({ local: { files: 10, edges: 5, docs: 2, truncated: true }, server: { files: 10, edges: 5, docs: 2 }, skipped: [], sources: [] });
        expect(Object.fromEntries(cut.map((s) => [s.id, s.state]))).toMatchObject({ graph: 'attention', match: 'attention' });
    });
    it('shares and formats sizes', () => {
        expect(serverShare(10, 5)).toBe(0.5);
        expect(serverShare(10, 50)).toBe(1);
        expect(serverShare(0, 3)).toBe(0);
        expect([formatBytes(12), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual(['12 B', '2.0 KB', '3.0 MB']);
    });
});

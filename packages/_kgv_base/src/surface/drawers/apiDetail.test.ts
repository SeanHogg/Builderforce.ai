import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { detailOf, endpointKey, paramsOf, referrersOf, selected, splitContract } from './apiDetail';
import { endpointsOf } from './apiModel';

const base = surfaceFixture();
const routesRef = 'src:sys::api/routes.ts' as const;
const testNode = { ...base.nodes.find((n) => n.label === 'api/routes.ts')!, ref: 'src:sys::api/routes.test.ts' as const, label: 'routes.test.ts', badges: {} };
const withTest = {
    ...base,
    nodes: [...base.nodes, testNode],
    edges: [...base.edges, { ...base.edges[0]!, from: testNode.ref, to: routesRef }],
};

describe('paramsOf', () => {
    it('reads path params in both spellings, query params written into the path, and a body for body methods', () => {
        expect(paramsOf({ method: 'GET', path: '/a/:id/b/{n}?limit=&page=1' })).toEqual([
            { name: 'id', where: 'path', source: 'route' }, { name: 'n', where: 'path', source: 'route' },
            { name: 'limit', where: 'query', source: 'route' }, { name: 'page', where: 'query', source: 'route' },
        ]);
        expect(paramsOf({ method: 'POST', path: '/users' })).toEqual([{ name: 'body', where: 'body', source: 'unknown-shape' }]);
        expect(paramsOf({ method: 'GET', path: '/users' })).toEqual([]);
    });
});

describe('detailOf', () => {
    const eps = endpointsOf(withTest, buildStations(withTest));
    const referrers = referrersOf(withTest);
    it('says tested only when a test file references the handler, and lists non-test callers apart', () => {
        const d = detailOf(referrers, eps.find((e) => e.path === '/users')!);
        expect(d.tested).toBe(true);
        expect(d.testFiles.map((f) => f.name)).toEqual(['routes.test.ts']);
        expect(d.callerFiles.map((f) => f.name)).toEqual(['web/page.tsx']);
    });
    it('is untested when nothing test-shaped references it', () => {
        const plain = endpointsOf(base, buildStations(base));
        const d = detailOf(referrersOf(base), plain[0]!);
        expect(d.tested).toBe(false);
        expect(d.testFiles).toEqual([]);
    });
});

describe('contract split and selection', () => {
    const eps = endpointsOf(base, buildStations(base));
    it('splits documented from undocumented', () => {
        const mixed = [{ ...eps[0]!, documented: true }, eps[1]!];
        const s = splitContract(mixed);
        expect(s.inContract).toHaveLength(1);
        expect(s.undocumented).toHaveLength(1);
    });
    it('selects by key in list order', () => {
        expect(selected(eps, new Set([endpointKey(eps[1]!)])).map((e) => e.path)).toEqual(['/users/:id']);
        expect(selected(eps, new Set())).toEqual([]);
    });
});

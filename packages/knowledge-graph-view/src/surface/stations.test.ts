import { describe, expect, it } from 'vitest';
import { codeFixture, docsFixture, surfaceFixture } from '../testing';
import { antiLevel, buildStations, changedRefs, quantileLevels, stationOfRef } from './stations';

const byName = (name: string, graph = surfaceFixture()) => buildStations(graph).stations.find((s) => s.name === name)!;

describe('buildStations', () => {
    it('makes one station per area, splits entry files out, and groups area-less files by top folder', () => {
        const names = buildStations(surfaceFixture()).stations.map((s) => s.name).sort();
        expect(names).toEqual(['API', 'Web app', 'cron', 'main.tsx', 'repositories']);
        expect(byName('main.tsx').entry).toBe(true);
        expect(byName('Web app').entry).toBe(false);
        expect(byName('cron')).toMatchObject({ kind: 'folder', entry: true, files: 1 });
    });

    it('maps files and their sections to the station', () => {
        const model = buildStations(surfaceFixture());
        const api = model.stations.find((s) => s.name === 'API')!;
        expect(stationOfRef(model, 'src:sys::api/useCase.ts')).toBe(api.id);
        expect(stationOfRef(model, 'src:sys::api/useCase.ts#part')).toBe(api.id);
        expect(stationOfRef(model, 'src:sys::nope.ts')).toBeUndefined();
    });

    it('rolls up complexity by quantile, coverage, churn, owner, patterns and layer', () => {
        const api = byName('API'), repos = byName('repositories');
        expect(api).toMatchObject({ cx: 4, cov: 0.8, churn: 1, owner: 'platform', patterns: ['adapter', 'repository'], layer: 'presentation', files: 2 });
        expect(repos).toMatchObject({ cx: 2, cov: 0.2, churn: 0.125, dup: 1, layer: 'infrastructure' });
    });

    it('scales usage to the busiest station', () => {
        const stations = buildStations(surfaceFixture()).stations;
        expect(stations[0]!.name).toBe('API');
        expect(stations[0]!.use).toBe(1);
        expect(stations.every((s) => s.use >= 0 && s.use <= 1)).toBe(true);
    });

    it('weights anti-patterns by the severity of the findings that touch the station', () => {
        expect(byName('API').anti).toBe(4);
        expect(byName('cron').anti).toBe(3);
        expect(byName('Web app').anti).toBe(1);
        expect(byName('API').findingIds).toHaveLength(2);
    });

    it('leaves metrics undefined, never zero, when the data is absent', () => {
        const stations = buildStations(codeFixture()).stations;
        for (const s of stations) {
            expect(s.cov).toBeUndefined();
            expect(s.cx).toBeUndefined();
            expect(s.churn).toBeUndefined();
            expect(s.owner).toBeUndefined();
        }
        expect(byName('Web app').cov).toBeUndefined();
    });

    it('marks a station changed from the passed set or a live badge, never from a stale file', () => {
        const graph = surfaceFixture();
        expect(buildStations(graph).stations.some((s) => s.changed)).toBe(false);
        const set = buildStations(graph, { changed: new Set(['src:sys::db/repo.ts']) }).stations;
        expect(set.filter((s) => s.changed).map((s) => s.name)).toEqual(['repositories']);
        const stale = { ...graph, nodes: graph.nodes.map((n) => (n.ref === 'src:sys::web/page.tsx' ? { ...n, stale: true } : n)) };
        expect(buildStations(stale).stations.find((s) => s.name === 'Web app')!.changed).toBe(false);
        const live = { ...graph, nodes: graph.nodes.map((n) => (n.ref === 'src:sys::web/page.tsx' ? { ...n, badges: { changed: 1 } } : n)) };
        expect(buildStations(live).stations.find((s) => s.name === 'Web app')!.changed).toBe(true);
    });

    it('counts a station by the importance of its own files, so a split entry station does not double-count', () => {
        const model = buildStations(surfaceFixture());
        const web = model.stations.find((s) => s.name === 'Web app')!, main = model.stations.find((s) => s.name === 'main.tsx')!;
        expect(web.use).toBeCloseTo(0.4 / 1.5, 5); // page.tsx only; the busiest station is API (0.7 + 0.8)
        expect(main.use).toBeCloseTo(0.5 / 1.5, 5);
    });

    it('maps area, claim and fact refs to the station of their file, so their findings are not dropped', () => {
        const g = surfaceFixture();
        const area = 'src:sys::area/API';
        const claim = { ref: 'fact:claim:x', kind: 'claim', label: 'c', pack: 'code', importance: 0.1, origin: 'model' } as const;
        const edge = { from: claim.ref, to: 'src:sys::api/useCase.ts', kind: 'about', weight: 1, origin: 'model' } as const;
        const finding = { id: 'f', kind: 'contradiction', pack: 'code', nodes: [area, claim.ref], severity: 'error', params: {} } as never;
        const model = buildStations({ ...g, nodes: [...g.nodes, claim as never], edges: [...g.edges, edge as never], findings: [finding] });
        expect(stationOfRef(model, area)).toBeDefined();
        expect(stationOfRef(model, claim.ref)).toBe(stationOfRef(model, 'src:sys::api/useCase.ts'));
        expect(model.stations.find((s) => s.name === 'API')!.findingIds).toEqual(['f']);
    });

    it('names two entry stations with the same file differently', () => {
        const g = surfaceFixture();
        const twin = { ...g.nodes.find((n) => n.ref === 'src:sys::web/main.tsx')!, ref: 'src:sys::api/main.tsx', label: 'api/main.tsx', area: 'src:sys::area/API' } as never;
        const names = buildStations({ ...g, nodes: [...g.nodes, twin] }).stations.filter((s) => s.entry).map((s) => s.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('groups a docs graph without areas by folder', () => {
        const names = buildStations(docsFixture()).stations.map((s) => s.name);
        expect(names).toContain('policy');
        expect(names).toContain('(root)');
    });

    it('is deterministic', () => {
        expect(buildStations(surfaceFixture()).stations).toEqual(buildStations(surfaceFixture()).stations);
    });
});

describe('antiLevel and quantileLevels', () => {
    it('maps the score to 1 to 5', () => {
        expect([0, 1, 2, 3, 5, 7, 8].map(antiLevel)).toEqual([1, 2, 3, 3, 4, 4, 5]);
    });
    it('gives a lone value the middle level and spreads many', () => {
        expect([...quantileLevels(new Map([['a', 7]])).values()]).toEqual([3]);
        const spread = quantileLevels(new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]));
        expect([...spread.values()]).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('changedRefs', () => {
    it('lists files whose source differs or is new', () => {
        const now = surfaceFixture();
        const before = { nodes: now.nodes.filter((n) => n.ref !== 'src:sys::cron/job.ts').map((n) => (n.ref === 'src:sys::web/page.tsx' ? { ...n, sourceHash: 'old' } : n)) };
        expect([...changedRefs(now, before)].sort()).toEqual(['src:sys::cron/job.ts', 'src:sys::web/page.tsx']);
        expect(changedRefs(now, null).size).toBe(0);
    });
});

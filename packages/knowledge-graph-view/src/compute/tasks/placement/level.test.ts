import { describe, expect, it } from 'vitest';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { MARK_TYPE_ORDER } from '../../../shapes';
import { withDocs } from '../../../surface/transit/testFixtures';
import { surfaceFixture } from '../../../testing';
import type { Placement } from '../../../stage/types';
import { buildStageModel, type StageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';
import { levelChildren, levelOf } from './levelChildren';
import { FOOT, heightOf, MINIS_MAX } from './levelGeometry';
import { drillKeyOf } from './request';

const req = (m: StageModel, over: Partial<PlacementReq> = {}): PlacementReq =>
    ({ graph: 1, generation: m.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, depth: 1, ...over });
const place = (g: KnowledgeGraph, m: StageModel, over: Partial<PlacementReq> = {}): Placement => {
    const r = req(m, over), t = PLACEMENTS[r.camera](g, m, r);
    while (!t.step());
    return t.result();
};

/** The surface fixture with every file tagged by `system` and `app`. */
const tagged = (system: (path: string) => string, app: (path: string) => string, base: KnowledgeGraph = surfaceFixture()): KnowledgeGraph => ({
    ...base,
    nodes: base.nodes.map((n) => (n.kind === 'file' && n.pack === 'code' ? { ...n, system: system(n.ref), app: app(n.ref) } : n)) as KnowledgeGraph['nodes'],
});
const twoSystems = tagged((r) => (r.includes('web/') ? 'web' : 'backend'), (r) => (r.includes('web/') ? 'web/site' : r.includes('db/') ? 'backend/db' : 'backend/api'));
const oneSystem = tagged(() => 'repo', (r) => (r.includes('web/') ? 'web' : r.includes('api/') ? 'api' : r.includes('db/') ? 'db' : ''));

describe('the level scene (Map and 3D draw ONE level at a time)', () => {
    it('the world of two systems is the two systems, on one floor', () => {
        const model = buildStageModel(twoSystems);
        const p = place(twoSystems, model);
        expect(p.level).toMatchObject({ level: 'world', ref: null, total: 2 });
        expect(p.level!.children.map((c) => c.name).sort()).toEqual(['backend', 'web']);
        expect(p.level!.children.every((c) => c.kind === 'system' && c.form === 'slab' && c.h === 0.45)).toBe(true);
        expect(p.a11y).toHaveLength(2);
        expect(p.planes.filter((pl) => pl.kind === 'room')).toHaveLength(1);
        expect(p.liftWithDepth).toBe(true);
        expect(p.rig.view?.radius).toBeGreaterThan(0);
        // a system folder that the MarkSet holds is a `system` mark
        const web = model.marks.keys.indexOf('dir:web');
        expect(MARK_TYPE_ORDER[model.marks.type[web]!]).toBe('system');
    });

    it('a single system opens onto its apps (and the code stations that have no app)', () => {
        const model = buildStageModel(oneSystem);
        const kids = levelChildren(oneSystem, model, null);
        expect(kids.filter((c) => c.role === 'app').map((c) => c.key).sort()).toEqual(['dir:api', 'dir:db', 'dir:web']);
        expect(kids.filter((c) => c.role === 'station').length).toBeGreaterThan(0);
        const p = place(oneSystem, model);
        expect(p.level!.children.filter((c) => c.kind === 'component').length).toBe(3);
    });

    it('a system frame draws its apps; an app frame draws its stations', () => {
        const model = buildStageModel(twoSystems);
        const sys = place(twoSystems, model, { drill: drillKeyOf({ level: 'system', ref: 'backend' }) });
        expect(sys.level).toMatchObject({ level: 'system', ref: 'backend' });
        expect(sys.level!.children.length).toBeGreaterThan(0);
        const app = place(twoSystems, model, { drill: drillKeyOf({ level: 'app', ref: 'backend/api' }) });
        expect(app.level).toMatchObject({ level: 'app', ref: 'backend/api' });
        expect(app.level!.children.every((c) => c.kind === 'component' || c.kind === 'store')).toBe(true);
        expect(app.planes[0]!.tone).not.toBe(place(twoSystems, model).planes[0]!.tone);   // inside a level the floor is the room tone
    });

    it('non-code stations are not children of any level: they are counted as not on the map', () => {
        const graph = withDocs();
        const model = buildStageModel(graph);
        const lv = levelOf(graph, model, null);
        expect(lv.children.map((c) => c.name)).not.toContain('docs');
        expect(lv.notOnMap.stations).toBeGreaterThanOrEqual(1);
        expect(lv.notOnMap.examples).toContain('docs');
        const p = place(graph, model);
        expect(p.level!.notOnMap).toEqual(lv.notOnMap);
    });

    it('a footprint is rectangular: aspect = the kind\'s depth ÷ width; heights follow the kind', () => {
        const model = buildStageModel(twoSystems);
        const p = place(twoSystems, model);
        for (const c of p.level!.children) expect(p.aspect![c.slot]).toBeCloseTo(FOOT.system[1] / FOOT.system[0], 5);
        expect(p.aspect).toHaveLength(model.marks.keys.length);
        expect(heightOf('component', 3)).toBe(0.45);
        expect(heightOf('system', undefined)).toBe(0.45);
        expect(heightOf('store', 1)).toBe(1);
        expect(heightOf('table', 1)).toBe(0.7);
        expect(heightOf('file', 3)).toBeCloseTo(0.45 + 3 * 0.36, 8);
        expect(heightOf('class', 1)).toBeCloseTo(0.45 + 0.36, 8);
        expect(heightOf('method', 2)).toBeCloseTo(0.35 + 2 * 0.22, 8);
        expect(heightOf('file', 9)).toBe(heightOf('file', 3));
        // Flat collapses through depth: extrude is the height at depth 1, nothing at 0.
        const flat = place(twoSystems, model, { depth: 0 });
        for (const { slot } of flat.a11y) expect(flat.extrude[slot]).toBe(0);
    });

    it('at most 12 miniatures stand on a roof, and links never outnumber twice the children', () => {
        const files: KNode[] = Array.from({ length: 20 }, (_, i) => ({
            ref: `src:big::big/f${i}.ts`, kind: 'file', label: `f${i}.ts`, pack: 'code', importance: 0.5 - i / 100, origin: 'extracted', partition: 'application', area: 'src:big::area/Big',
        }) as KNode);
        const area = { ref: 'src:big::area/Big', kind: 'area', label: 'Big', pack: 'code', importance: 0.9, origin: 'extracted' } as KNode;
        const other = { ref: 'src:big::web/main.tsx', kind: 'file', label: 'main.tsx', pack: 'code', importance: 0.5, origin: 'extracted', partition: 'entry' } as KNode;
        const base = surfaceFixture('big');
        const graph: KnowledgeGraph = { ...base, nodes: [area, ...files, other], edges: [{ from: other.ref, to: files[0]!.ref, kind: 'references', weight: 1, origin: 'extracted' }], findings: [] };
        const model = buildStageModel(graph);
        const p = place(graph, model);
        const big = model.stations.stations.find((s) => s.name === 'Big')!;
        const bigSlot = model.stationSlot.get(big.id)!;
        const minis = files.filter((f) => p.scale[model.nodeSlot.get(f.ref)!]! > 0);
        expect(minis).toHaveLength(MINIS_MAX);
        for (const f of minis) expect(model.marks.parentStation[model.nodeSlot.get(f.ref)!]).toBe(bigSlot);
        const hall = p.links.find((b) => b.family === 'hall')!;
        expect(hall.lineIds!.length).toBe(hall.group.length === 0 ? 0 : hall.lineIds!.length);
        expect(hall.lineIds!.length).toBeLessThanOrEqual(2 * p.level!.children.length);
        expect(p.level!.children.find((c) => c.slot === bigSlot)!.minis).toBe(20);
    });

    it('a package frame draws the files of the station, with ghosts for what it reaches', () => {
        const graph = surfaceFixture();
        const model = buildStageModel(graph);
        const api = model.stations.stations.find((s) => s.name === 'API')!;
        const p = place(graph, model, { drill: drillKeyOf({ level: 'package', ref: api.id }) });
        expect(p.level).toMatchObject({ level: 'package', ref: api.id });
        expect(p.level!.children.length).toBeGreaterThan(0);
        expect(p.scale[model.stationSlot.get(api.id)!]).toBe(0);
    });
});

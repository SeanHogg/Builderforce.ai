import { describe, expect, it } from 'vitest';
import type { CallSite, KEdge, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../../../testing';
import { CLASS_REF, FAIL_REF, RUN_REF, withSymbols } from '../../../surface/transit/testFixtures';
import type { LabelText, TextPort } from '../../../stage/labels/LabelLayer';
import { createNoopStage, createWebGLStage } from '../../../stage/renderer';
import type { Placement } from '../../../stage/types';
import type { SymbolRecord } from '../../../types';
import { typeIndex } from '../markSet';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';
import { placeDrill } from './drill';
import { drillKeyOf } from './request';

// The Sequence fixture: `handle` calls an external (pg) and two methods; the graph itself holds no external node.
const site = (order: number, line: number): CallSite => ({ path: 'api/x.ts', line, column: 4, order });
const calls = (from: string, to: string, sites: CallSite[]): KEdge => ({ from: from as KEdge['from'], to: to as KEdge['to'], kind: 'calls', weight: 1, origin: 'extracted', sites });
const fixture = withSymbols(surfaceFixture());
const graph: KnowledgeGraph = { ...fixture, edges: [...fixture.edges, calls(RUN_REF, FAIL_REF, [site(0, 12)])] };
const ROUTES = 'src:sys::api/routes.ts';
const ROUTER = `${ROUTES}#Router@1`, HANDLE = `${ROUTES}#Router.handle@2`, LOG = `${ROUTES}#Router.log@5`, EXTRA = `${ROUTES}#Router.extra@9`;
const PG = 'ext:src:sys::node_modules/pg#query';
const records: SymbolRecord[] = [
    { ref: ROUTER, name: 'Router', kind: 'class', parent: ROUTES, line: 1, exported: true, relations: [{ kind: 'extends', to: CLASS_REF }] },
    {
        ref: HANDLE, name: 'Router.handle', kind: 'method', parent: ROUTER, line: 2, exported: true,
        relations: [{ kind: 'calls', to: `${ROUTES}#Router.log`, sites: [site(2, 4)] }, { kind: 'calls', to: RUN_REF, sites: [site(1, 3)] }, { kind: 'calls', to: PG.slice(4), sites: [site(0, 2)] }],
    },
    { ref: LOG, name: 'Router.log', kind: 'method', parent: ROUTER, line: 5, exported: false },
];
const more: SymbolRecord[] = [...records, { ref: EXTRA, name: 'Router.extra', kind: 'method', parent: ROUTER, line: 9, exported: false }];

const textPort = (): TextPort => ({
    object: null,
    create: () => ({ text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText),
    add() {}, remove() {}, dispose() {},
});

function setup() {
    const model = buildStageModel(graph, []);
    const base = model.marks.keys.length;
    const req = (over: Partial<PlacementReq>): PlacementReq => ({ graph: 1, generation: model.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...over });
    const run = (camera: PlacementReq['camera'], over: Partial<PlacementReq>): Placement => { const t = PLACEMENTS[camera](graph, model, req({ camera, ...over })); while (!t.step()); return t.result(); };
    const sequence = () => run('sequence', { lod: 2, pathId: `node:${HANDLE}`, symbols: records });
    const drill = (symbols: readonly SymbolRecord[]) => placeDrill(graph, model, req({ drill: drillKeyOf({ level: 'class', ref: ROUTES }), symbols }));
    return { model, base, run, sequence, drill };
}

describe('appended slots are numbered by KEY (one fold for the drill and the Sequence)', () => {
    it('a Sequence with an external on a graph with none appends into the reserved external batch: 0 meshes, no rebuild', () => {
        const { model, run, sequence } = setup();
        expect(model.marks.type.includes(typeIndex('external'))).toBe(false);
        expect(model.marks.batches.some((b) => b.type === typeIndex('external') && b.slots.length === 0)).toBe(true);
        const stage = createWebGLStage({ text: textPort });
        stage.setMarks(model.marks);
        stage.setPlacement(run('map', {}), 0, 0);
        const created = stage.stats.meshesCreated;
        const seq = sequence();
        expect(seq.append!.keys).toContain(PG);
        stage.setPlacement(seq, 0, 400);
        expect(stage.stats.meshesCreated).toBe(created);
        expect(stage.marks).toBe(model.marks);                       // the headroom took them: no rebuild
    });

    it('a drill after a Sequence keeps both sets of slots distinct and stable; the renderer\'s live keys agree', () => {
        const { base, sequence, drill } = setup();
        const seq = sequence();
        const seqKeys = seq.append!.keys;
        const pgSlot = base + seqKeys.indexOf(PG);
        // A drill that loaded one more definition: every key the Sequence appended keeps its slot (the external too);
        // the new definition takes the next free slot — never the external's.
        const inside = drill(more);
        expect(inside.append!.base).toBe(base);
        expect(inside.append!.keys.slice(0, seqKeys.length)).toEqual(seqKeys);
        expect(base + inside.append!.keys.indexOf(PG)).toBe(pgSlot);
        expect(base + inside.append!.keys.indexOf(`node:${EXTRA}`)).toBe(base + seqKeys.length);
        expect(new Set(inside.append!.keys).size).toBe(inside.append!.keys.length);
        // Back to the Sequence: same slots again.
        const again = sequence();
        expect(base + again.append!.keys.indexOf(PG)).toBe(pgSlot);

        // The renderer folds the same runs to the same live keys (a fresh model: its own registry).
        const stage = createNoopStage();
        const fresh = setup();
        stage.setMarks(fresh.model.marks);
        const s1 = fresh.sequence(), d1 = fresh.drill(more);
        stage.setPlacement(s1, 0, 0);
        stage.setPlacement(d1, 0, 0);
        const keys = stage.keys();
        expect(keys.length).toBe(fresh.base + d1.append!.keys.length);
        d1.append!.keys.forEach((k, i) => expect(keys[fresh.base + i]).toBe(k));
        expect(new Set(keys).size).toBe(keys.length);
    });
});

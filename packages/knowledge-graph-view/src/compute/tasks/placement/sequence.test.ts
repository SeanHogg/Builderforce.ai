import { describe, expect, it } from 'vitest';
import type { CallSite, KEdge, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../../../testing';
import { CLASS_REF, FAIL_REF, RUN_REF, withSymbols } from '../../../surface/transit/testFixtures';
import { SLOT_STATION, type LinkBatch, type Placement } from '../../../stage/types';
import type { SymbolRecord } from '../../../types';
import { typeIndex } from '../markSet';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';
import { SEQUENCE_MAX_DEPTH, SEQUENCE_MAX_MESSAGES } from './sequenceFlow';

const site = (order: number, line: number): CallSite => ({ path: 'api/x.ts', line, column: 4, order });
const calls = (from: string, to: string, sites: CallSite[]): KEdge => ({ from: from as KEdge['from'], to: to as KEdge['to'], kind: 'calls', weight: 1, origin: 'extracted', sites });

const base = withSymbols(surfaceFixture());
const graph: KnowledgeGraph = { ...base, edges: [...base.edges, calls(RUN_REF, FAIL_REF, [site(0, 12)])] };
const model = buildStageModel(graph, []);

const ROUTES = 'src:sys::api/routes.ts';
const ROUTER = `${ROUTES}#Router@1`, HANDLE = `${ROUTES}#Router.handle@2`, LOG = `${ROUTES}#Router.log@5`;
const PG = 'ext:src:sys::node_modules/pg#query';
/** Loaded records: `handle` calls an external (order 0), `UseCase.run` (order 1), then `log` (order 2); Router extends UseCase. */
const records: SymbolRecord[] = [
    { ref: ROUTER, name: 'Router', kind: 'class', parent: ROUTES, line: 1, exported: true, relations: [{ kind: 'extends', to: CLASS_REF }] },
    {
        ref: HANDLE, name: 'Router.handle', kind: 'method', parent: ROUTER, line: 2, exported: true,
        relations: [{ kind: 'calls', to: `${ROUTES}#Router.log`, sites: [site(2, 4)] }, { kind: 'calls', to: RUN_REF, sites: [site(1, 3)] }, { kind: 'calls', to: PG.slice(4), sites: [site(0, 2)] }],
    },
    { ref: LOG, name: 'Router.log', kind: 'method', parent: ROUTER, line: 5, exported: false },
];

const req = (over: Partial<PlacementReq> = {}): PlacementReq =>
    ({ graph: 1, generation: model.marks.generation, camera: 'sequence', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...over });
const run = (g: KnowledgeGraph, r: PlacementReq, m = model): Placement => { const t = PLACEMENTS.sequence(g, m, r); while (!t.step()); return t.result(); };
const keyOf = (p: Placement, slot: number): string => (slot < model.marks.keys.length ? model.marks.keys[slot]! : p.append!.keys[slot - p.append!.base]!);
const slotOfKey = (p: Placement, key: string): number => { const i = model.marks.keys.indexOf(key); return i >= 0 ? i : p.append!.base + p.append!.keys.indexOf(key); };
const xOf = (p: Placement, slot: number) => p.position[slot * 3]!;
const at = (p: Placement, s: number) => [0, 1, 2].map((k) => p.position[s * 3 + k]!);
const participants = (p: Placement): string[] => [...p.a11y].sort((a, b) => xOf(p, a.slot) - xOf(p, b.slot)).map((a) => keyOf(p, a.slot));
const family = (p: Placement, f: LinkBatch['family']) => p.links.find((l) => l.family === f);
/** The z of polyline `g`'s first point (polylines are separated by a NaN triple). */
function zOfGroup(b: LinkBatch, g: number): number {
    let line = 0;
    for (let pi = 0; pi < b.points.length / 3; pi++) {
        if (Number.isNaN(b.points[pi * 3]!)) { line++; continue; }
        if (line === g) return b.points[pi * 3 + 2]!;
    }
    return NaN;
}

const method = () => run(graph, req({ lod: 2, pathId: `node:${HANDLE}`, symbols: records }));
const klass = () => run(graph, req({ lod: 1, pathId: `node:${HANDLE}`, symbols: records }));

describe('the Sequence placement (PRD 43 B1a rule 10)', () => {
    it('system band: the line\'s stations in stop order, one message per hop; every other slot hidden', () => {
        const p = run(graph, req({ lod: 0 }));
        const line = model.lines.lines[0]!;
        expect(participants(p)).toEqual(line.stops.map((id) => `st:${id}`));
        for (const { slot } of p.a11y) expect(model.marks.slotKind[slot]).toBe(SLOT_STATION);
        const shown = new Set(p.a11y.map((a) => a.slot));
        for (let i = 0; i < model.marks.keys.length; i++) if (!shown.has(i)) expect(p.scale[i]).toBe(0);
        expect(family(p, 'arrow')!.callSites).toHaveLength(line.stops.length - 1); // no returns at the system band
        expect(family(p, 'edge')).toBeDefined(); // the lifelines
        expect(family(p, 'route')).toBeUndefined(); // no activation bars
    });

    it('method band: messages in call-site order (depth-first), each carrying its site; the external is a participant', () => {
        const p = method();
        const sites = family(p, 'arrow')!.callSites!;
        expect(sites.slice(0, 4).map((s) => [s!.order, s!.line])).toEqual([[0, 2], [1, 3], [0, 12], [2, 4]]);
        expect(participants(p)).toEqual([`node:${HANDLE}`, PG, `node:${RUN_REF}`, `node:${FAIL_REF}`, `node:${LOG}`]);
        expect(p.caption).toEqual({ shown: 4, total: 4, capped: false });
    });

    it('external terminus: an appended slot of the dashed-cross `external` type, shown', () => {
        const p = method();
        const slot = slotOfKey(p, PG);
        expect(slot).toBeGreaterThanOrEqual(p.append!.base);
        expect(p.append!.type[slot - p.append!.base]).toBe(typeIndex('external'));
        expect(p.scale[slot]).toBeGreaterThan(0);
    });

    it('activation bars and returns: one per call to another participant; a nested call returns before its caller', () => {
        const p = method();
        const arrows = family(p, 'arrow')!;
        // 4 messages + 4 returns (none is a self-call); returns carry no call site.
        expect(arrows.callSites).toHaveLength(8);
        expect(arrows.callSites!.slice(4)).toEqual([null, null, null, null]);
        expect(new Set(family(p, 'route')!.group).size).toBe(4);
        // Returns: [pg, run (ends after run→fail), fail, log]. run→fail's return (depth 1) sits above handle→run's (depth 0).
        const runReturn = zOfGroup(arrows, 5), failReturn = zOfGroup(arrows, 6), failCall = zOfGroup(arrows, 2);
        expect(failReturn).toBeGreaterThan(failCall);
        expect(runReturn).toBeGreaterThan(failReturn);
    });

    it('class band: calls BETWEEN classes, plus the extends stub; the method band draws no stubs', () => {
        const p = klass();
        expect(participants(p)).toEqual([`node:${ROUTER}`, PG, `node:${CLASS_REF}`]);
        expect(family(p, 'arrow')!.callSites!.slice(0, 2).map((s) => s!.order)).toEqual([0, 1]);
        const stubs = family(p, 'describes')!;
        expect(new Set(stubs.group).size).toBe(1);
        expect(family(method(), 'describes')).toBeUndefined();
    });

    it('zoom splits a class into its methods on the SAME slots: class band parks methods at the class; method band parks the class at its methods', () => {
        const c = klass(), m = method();
        expect(c.append!.keys).toEqual(m.append!.keys);
        const router = slotOfKey(c, `node:${ROUTER}`), handle = slotOfKey(c, `node:${HANDLE}`), log = slotOfKey(c, `node:${LOG}`);
        expect(c.scale[handle]).toBe(0);
        expect(at(c, handle)).toEqual(at(c, router));
        expect(at(c, log)).toEqual(at(c, router));
        expect(m.scale[router]).toBe(0);
        at(m, router).forEach((v, k) => expect(v).toBeCloseTo((at(m, handle)[k]! + at(m, log)[k]!) / 2, 3));
    });

    it('caps the depth and the message count', () => {
        const chain = Array.from({ length: 10 }, (_, i) => `${ROUTES}#f${i}`);
        const deep: KnowledgeGraph = {
            ...graph,
            nodes: [...graph.nodes, ...chain.map((ref, i) => ({ ref: ref as never, kind: 'symbol' as const, label: `f${i}`, pack: 'code', importance: 0.3, origin: 'extracted' as const, badges: { symbolKind: 'function', line: i + 1 } }))],
            edges: [...graph.edges, ...chain.slice(1).map((to, i) => calls(chain[i]!, to, [site(0, i + 1)]))],
        };
        const m = buildStageModel(deep, []);
        const p = run(deep, req({ generation: m.marks.generation, lod: 2, pathId: `node:${chain[0]}` }), m);
        expect(p.caption.shown).toBe(SEQUENCE_MAX_DEPTH);

        const fan = Array.from({ length: 100 }, (_, i) => `${ROUTES}#g${i}`);
        const wide: KnowledgeGraph = {
            ...graph,
            nodes: [...graph.nodes, ...[`${ROUTES}#hub`, ...fan].map((ref) => ({ ref: ref as never, kind: 'symbol' as const, label: ref.split('#')[1]!, pack: 'code', importance: 0.3, origin: 'extracted' as const, badges: { symbolKind: 'function' } }))],
            edges: [...graph.edges, ...fan.map((to, i) => calls(`${ROUTES}#hub`, to, [site(i, i + 1)]))],
        };
        const w = buildStageModel(wide, []);
        const q = run(wide, req({ generation: w.marks.generation, lod: 2, pathId: `node:${ROUTES}#hub` }), w);
        expect(q.caption).toEqual({ shown: SEQUENCE_MAX_MESSAGES, total: 100, capped: true });
    });

    it('hides non-participants and keys the cache by the band and the loaded symbols', () => {
        const a = run(graph, req({ lod: 2, pathId: `node:${RUN_REF}` }));
        expect(a.a11y.map((x) => keyOf(a, x.slot))).toEqual([`node:${RUN_REF}`, `node:${FAIL_REF}`]);
        const b = run(graph, req({ lod: 2, pathId: `node:${RUN_REF}`, symbols: records }));
        expect(b.cacheKey).not.toBe(a.cacheKey);
        expect(run(graph, req({ lod: 1, pathId: `node:${RUN_REF}` })).cacheKey).not.toBe(a.cacheKey);
    });
});

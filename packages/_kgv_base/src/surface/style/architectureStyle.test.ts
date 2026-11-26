/** The Architecture style model: each style wins on the graph shaped like it, with the evidence it was scored on; equal graphs read equal. */
import { describe, expect, it } from 'vitest';
import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { architectureStyleOf, FIT_THRESHOLD, scoreStyles } from './architectureStyle';
import { readStyleSignals } from './signals';

const ref = (path: string) => `src:r::${path}`;
const file = (path: string, partition: string, extra: Partial<KNode> = {}): KNode =>
    ({ ref: ref(path) as KNode['ref'], kind: 'file', label: path, pack: 'code', partition, importance: 0.5, origin: 'extracted', ...extra });
const dep = (from: string, to: string): KEdge => ({ from: ref(from) as KEdge['from'], to: ref(to) as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted' });
const graphOf = (nodes: KNode[], edges: KEdge[]): KnowledgeGraph => ({
    scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes, edges, findings: [],
    stats: { sources: nodes.length, nodes: nodes.length, edges: edges.length, stale: 0, truncated: false },
});
const check = (g: KnowledgeGraph, style: string, id: string) => architectureStyleOf(g).styles.find((s) => s.id === style)!.checks.find((c) => c.id === id)!;

/** Infrastructure depends inward on the domain; the domain depends on nothing outside it. */
const onion = graphOf(
    [file('main.ts', 'entry'), file('page.ts', 'presentation'), file('useCase.ts', 'application'), file('pricing.ts', 'domain'),
        file('rules.ts', 'domain'), file('db.ts', 'infrastructure'), file('pricing.test.ts', 'domain')],
    [dep('main.ts', 'page.ts'), dep('page.ts', 'useCase.ts'), dep('useCase.ts', 'pricing.ts'), dep('db.ts', 'pricing.ts'),
        dep('db.ts', 'useCase.ts'), dep('pricing.ts', 'rules.ts'), dep('pricing.test.ts', 'db.ts')],
);

/** Classic layers: every dependency points down, the domain included (it calls the data layer). */
const layered = graphOf(
    [file('page.ts', 'presentation'), file('service.ts', 'application'), file('model.ts', 'domain'), file('store.ts', 'infrastructure')],
    [dep('page.ts', 'service.ts'), dep('service.ts', 'model.ts'), dep('model.ts', 'store.ts')],
);

/** Three systems, each with its own entry point and routes, none referencing another. */
const services = graphOf(
    ['orders', 'billing', 'users'].flatMap((s) => [
        file(`${s}/main.ts`, 'entry', { system: s }),
        file(`${s}/routes.ts`, 'presentation', { system: s, badges: { routes: `GET /${s}` } }),
    ]),
    ['orders', 'billing', 'users'].map((s) => dep(`${s}/main.ts`, `${s}/routes.ts`)),
);

describe('architectureStyleOf', () => {
    it('reads dependency inversion as Onion, with the inward edges as evidence', () => {
        const a = architectureStyleOf(onion);
        expect(a.winner).toBe('onion');
        expect(a.styles[0]!.fit).toBe(1);
        const inverted = check(onion, 'onion', 'inverted');
        expect(inverted.evidence).toEqual({ count: 2, total: 2, refs: [ref('db.ts')] });
        expect(check(onion, 'onion', 'domainIsolated').evidence).toMatchObject({ count: 0, total: 1 });
    });

    it('leaves test files out of every reading', () => {
        expect(readStyleSignals(onion).files).toBe(6);
        expect(readStyleSignals(onion).domain).toMatchObject({ count: 2, total: 6 });
    });

    it('reads downward layers in one unit as N-Layer, and a domain that calls outward fails the Onion and DDD rule', () => {
        const a = architectureStyleOf(layered);
        expect(a.winner).toBe('nLayer');
        expect(check(layered, 'onion', 'domainIsolated')).toMatchObject({ met: 0, evidence: { count: 1, total: 1, refs: [ref('model.ts')] } });
        expect(a.styles.find((s) => s.id === 'onion')!.fit).toBeLessThan(FIT_THRESHOLD);
    });

    it('reads independent systems with their own entry points as Microservices', () => {
        const a = architectureStyleOf(services);
        expect(a.winner).toBe('microservices');
        expect(check(services, 'microservices', 'manyUnits').evidence).toMatchObject({ count: 3, total: 3 });
        expect(check(services, 'microservices', 'independent')).toMatchObject({ met: 1, evidence: { count: 0, total: 3 } });
        expect(check(services, 'nLayer', 'singleUnit').met).toBe(0);
    });

    it('names no style when none fits clearly', () => {
        const a = architectureStyleOf(graphOf([file('a.ts', 'other')], []));
        expect(a.winner).toBeNull();
        expect(a.styles.every((s) => s.fit < FIT_THRESHOLD)).toBe(true);
    });

    it('ranks every style best first, ties in the fixed order, the same for any input order', () => {
        const shuffled = graphOf([...onion.nodes].reverse(), [...onion.edges].reverse());
        expect(architectureStyleOf(shuffled)).toEqual(architectureStyleOf(onion));
        // Nothing read: only "one deployable unit" holds (N-Layer, 1 of 5), every other style ties at 0 in the fixed order.
        const a = scoreStyles(readStyleSignals(graphOf([], [])));
        expect(a.styles.map((s) => s.id)).toEqual(['nLayer', 'ddd', 'onion', 'nTier', 'clientServer', 'microservices']);
        expect(a.winner).toBeNull();
        for (let i = 1; i < a.styles.length; i++) expect(a.styles[i - 1]!.fit).toBeGreaterThanOrEqual(a.styles[i]!.fit);
    });
});

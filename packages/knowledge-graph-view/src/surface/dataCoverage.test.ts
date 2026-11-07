/** What the graph carries and why a channel is empty: the one reading the UI and the diagnostics share. */
import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { dataCoverage, gapOf } from './dataCoverage';
import { notSetUpText } from './notSetUpText';
import { metricStatus } from './overlays';
import { outlineFixture, truncatedFixture } from './outlineFixture';
import { buildStations } from './stations';

/** The user's case: the server cut the graph and sent no outline. */
const cut = truncatedFixture(false);
const withOutline = truncatedFixture(true);
/** An outline whose files carry no badges at all (a review that predates the per-file extractor). */
const bare: KnowledgeGraph = { ...withOutline, outline: { ...outlineFixture(), files: outlineFixture().files.map(({ badges: _b, ...f }) => f) } };

describe('dataCoverage', () => {
    it('reads a graph the server cut with no outline as the cut graph, with the files it really shows', () => {
        expect(dataCoverage(cut).source).toEqual({ kind: 'cut', files: 1, sources: 5 });
        const c = dataCoverage(cut);
        expect(c.channels.complexity).toMatchObject({ have: 0, of: 1, reason: 'no-outline' });
        expect(c.channels.coverage.reason).toBe('no-outline');
    });

    it('reads an outline: files from the outline, the badges it carries counted per key', () => {
        const c = dataCoverage(withOutline);
        expect(c.source).toEqual({ kind: 'outline', files: 5, capped: false });
        expect(c.channels.complexity).toMatchObject({ have: 1, of: 5, reason: null });
        // Badges present elsewhere but never this one: it was not collected.
        expect(c.channels.churn.reason).toBe('not-collected');
        expect(c.noPartition).toBe(0);
    });

    it('says re-review when no file carries any badge', () => {
        expect(dataCoverage(bare).channels.complexity.reason).toBe('no-badges');
    });

    it('counts a complete graph as full', () => {
        const full: KnowledgeGraph = { ...cut, stats: { ...cut.stats, truncated: false } };
        expect(dataCoverage(full).source.kind).toBe('full');
    });

    it('maps a metric to its gap; metrics that need no badge never have one', () => {
        const c = dataCoverage(cut);
        expect(gapOf(c, 'owner')).toBe('no-outline');
        expect(gapOf(c, 'anti')).toBeNull();
        expect(gapOf(c, 'use')).toBeNull();
    });
});

describe('one rule for "not set up", shared by the coverage facts and the stations', () => {
    const ref = (path: string) => `src:r::${path}` as KNode['ref'];
    const file = (path: string): KNode => ({ ref: ref(path), kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted', sourceHash: `h:${path}`, partition: 'application' });
    const reachGraph: KnowledgeGraph = {
        scope: { rootId: 'r', packs: ['code'], digest: 'd' },
        nodes: [file('a/a.test.ts'), file('a/one.ts'), file('b/two.ts')],
        edges: [{ from: ref('a/a.test.ts'), to: ref('a/one.ts'), kind: 'references', weight: 1, origin: 'extracted' }],
        findings: [], stats: { sources: 3, nodes: 3, edges: 1, stale: 0, truncated: false },
    };

    it('counts coverage as available when only the heuristic static reach reads it (no badge on any file)', () => {
        const c = dataCoverage(reachGraph);
        expect(c.channels.coverage).toMatchObject({ have: 0, reached: true, reason: null });
        expect(gapOf(c, 'cov')).toBeNull();
        expect(notSetUpText(L, c, 'cov')).toBe(L.surface.notSetUp); // no gap: the plain words, never a reason
    });

    it('agrees with the stations for every metric, on a reach-only graph, a cut graph and a bare outline', () => {
        for (const g of [reachGraph, cut, withOutline, bare]) {
            const c = dataCoverage(g);
            const stations = buildStations(g).stations;
            for (const m of ['cx', 'cov', 'churn', 'owner'] as const) {
                expect(metricStatus(m, stations) === 'not-set-up', m).toBe(gapOf(c, m) !== null);
            }
        }
    });
});

describe('notSetUpText', () => {
    it('is plain "Not set up" with no coverage facts', () => {
        expect(notSetUpText(L, null, 'churn')).toBe(L.surface.notSetUp);
        expect(notSetUpText(L, dataCoverage(withOutline), 'cx')).toBe(L.surface.notSetUp);
    });

    it('adds the reason: only part of the files were sent, or nothing was collected', () => {
        const e = L.surface.explain;
        expect(notSetUpText(L, dataCoverage(cut), 'churn')).toBe(fillTemplate(e.notSetUpWhy, { reason: fillTemplate(e.whyNoOutline, { shown: '1', files: '5 files' }) }));
        expect(notSetUpText(L, dataCoverage(bare), 'churn')).toContain(fillTemplate(e.whyNoBadges, { metric: L.surface.metricNames.churn.toLocaleLowerCase() }));
        expect(notSetUpText(L, dataCoverage(withOutline), 'churn')).toContain(fillTemplate(e.whyNotCollected, { metric: L.surface.metricNames.churn.toLocaleLowerCase() }));
    });
});

import { describe, expect, it, vi } from 'vitest';
import type { PlanDetail, ReviewPlan, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import { planDetailOf } from '../knowledge/codeFixtures.test-util.js';
import {
    KNOWLEDGE_GRAPH, KNOWLEDGE_PREFETCH_ROWS, KNOWLEDGE_REVIEW_DIR, graphFocusOf, graphShown, knowledgePrefetchExecutors, reviewTargetOf,
    type KnowledgeRowsHost,
} from './knowledgeRows.js';

const PLAN: ReviewPlan = {
    rootId: 'repo/contracts', files: 12, byPack: { code: 8, docs: 4 }, unchanged: 5, changed: [], removed: [], skipped: [], estimatedModelCalls: 37,
};
/** The walk behind the plan — what the confirmed run must be handed back. */
const DETAIL: PlanDetail = planDetailOf(PLAN);
const REPORT: ReviewReport = {
    rootId: 'repo/contracts', digest: 'd', extracted: 7, judged: 30, unjudged: 0, invalidJudgements: 0, factsWritten: 9,
    relationsWritten: 4, staleMarked: 7, aborted: false, readErrors: 0, durationMs: 5,
};

function host(): KnowledgeRowsHost & { opened: string[]; plans: number; reviewedWith: PlanDetail[]; shown: Array<[string, string[]]> } {
    const h = {
        opened: [] as string[],
        reviewedWith: [] as PlanDetail[],
        plans: 0,
        shown: [] as Array<[string, string[]]>,
        async openReview(dir: string) {
            h.opened.push(dir);
            if (dir === 'missing') return null;
            return {
                rootId: dir ? `repo/${dir}` : 'repo',
                title: dir || 'repo',
                plan: async () => { h.plans += 1; return DETAIL; },
                review: async (plan: PlanDetail) => { h.reviewedWith.push(plan); return REPORT; },
            };
        },
        rootId: () => 'repo',
        async showGraph(rootId: string, focus: string[]) {
            h.shown.push([rootId, focus]);
            return { text: `opened ${rootId}`, chip: { labelKey: 'prefetch.chip.openInGraph', command: 'builderforce.openKnowledgeGraph', args: { rootId, focus } } };
        },
    };
    return h;
}

const signal = new AbortController().signal;

describe('the knowledge PreFetch rows', () => {
    it('declares review-dir as a confirmed write and graph as a read', () => {
        const byId = Object.fromEntries(KNOWLEDGE_PREFETCH_ROWS.map((r) => [r.id, r]));
        expect(byId[KNOWLEDGE_REVIEW_DIR]).toMatchObject({ kind: 'answer', sideEffect: 'write', slash: '/review' });
        expect(byId[KNOWLEDGE_GRAPH]).toMatchObject({ kind: 'answer', sideEffect: 'read', slash: '/graph' });
    });

    it('reads the folder a request names', () => {
        expect(reviewTargetOf('/review contracts')).toBe('contracts');
        expect(reviewTargetOf('review ./contracts')).toBe('contracts');
        expect(reviewTargetOf('build a knowledge graph of docs/specs/')).toBe('docs/specs');
        expect(reviewTargetOf('/review .')).toBe('');
        expect(reviewTargetOf('/review')).toBe('');
        expect(graphFocusOf('/graph src/a.ts and docs/b.md', 'repo')).toEqual(['src:repo::src/a.ts', 'src:repo::docs/b.md']);
    });

    it('previews the plan numbers for the confirm chip, then reviews on the SAME plan', async () => {
        const h = host();
        const ex = knowledgePrefetchExecutors(h);
        const detail = await ex[KNOWLEDGE_REVIEW_DIR]!.preview!('/review contracts', signal);
        expect(detail).toContain('12 files (code 8 · docs 4)');
        expect(detail).toContain('5 unchanged');
        expect(detail).toContain('≈ 37 model calls');

        const out = await ex[KNOWLEDGE_REVIEW_DIR]!.run('/review contracts', signal);
        expect(h.plans).toBe(1);
        // The confirmed run gets the walk the preview made, not a fresh one.
        expect(h.reviewedWith).toEqual([DETAIL]);
        expect(h.reviewedWith[0]).toBe(DETAIL);
        expect(h.opened).toEqual(['contracts']);
        expect(out?.text).toContain('Reviewed contracts');
        expect(out?.chips?.[0]?.command).toBe('builderforce.openKnowledgeGraph');
        expect(h.shown).toEqual([['repo/contracts', []]]);
    });

    it('answers plainly when the folder is not there', async () => {
        const out = await knowledgePrefetchExecutors(host())[KNOWLEDGE_REVIEW_DIR]!.run('/review missing', signal);
        expect(out?.text).toContain('`missing`');
        expect(out?.chips).toBeUndefined();
    });

    it('re-plans when the preview is stale', async () => {
        let now = 0;
        const h = host();
        const ex = knowledgePrefetchExecutors(h, () => now);
        await ex[KNOWLEDGE_REVIEW_DIR]!.preview!('/review contracts', signal);
        now += 11 * 60_000;
        await ex[KNOWLEDGE_REVIEW_DIR]!.run('/review contracts', signal);
        expect(h.plans).toBe(2);
    });

    it('matches the ways people ask to see the graph, and not a review request', () => {
        const graph = KNOWLEDGE_PREFETCH_ROWS.find((r) => r.id === KNOWLEDGE_GRAPH)!;
        const review = KNOWLEDGE_PREFETCH_ROWS.find((r) => r.id === KNOWLEDGE_REVIEW_DIR)!;
        const hits = (row: typeof graph, text: string) => (row.patterns ?? []).some((p) => p.test(text));
        for (const text of [
            'show me the graph', 'open the knowledge graph', 'show me the layers',
            'show me the dependency graph', 'show me the knowledge graph of src/', 'display the layers in the graph', 'view the knowledge graph',
            'show me the code graph', 'show the layer graph', 'open the graph please', 'show me the graph of src/a.ts', 'see the layers in the graph', 'show me the unpartitioned files in the graph', 'Show me the graph.', 'show me the graph of docs/specs',
        ]) expect(hits(graph, text), text).toBe(true);
        for (const text of [
            'build a knowledge graph of docs/', 'review ./contracts', 'what is a graph database',
            // A graph of someone's DATA is not this system's graph.
            'show me a graph of revenue', 'show me the graph of revenue by month', 'display a graph of sales', 'plot the graph of x squared',
            'show me the sales graph', 'view the graph of the stock price',
            'Show me the graph of revenue.', 'Show me the graph for Q3.', 'show me the revenue spike in the graph', 'show me the p95 latency in the graph',
            // Duplicates and clones are dup.check's, which answers with its own Open in graph chip.
            'show me the duplicates', 'show the duplicates in the graph', 'show me the clones in the graph', 'show the cycles in the graph',
        ]) expect(hits(graph, text), text).toBe(false);
        expect(hits(review, 'build a knowledge graph of docs/')).toBe(true);
    });

    it('opens the graph focused on the files the request names', async () => {
        const h = host();
        const show = vi.spyOn(h, 'showGraph');
        const out = await knowledgePrefetchExecutors(h)[KNOWLEDGE_GRAPH]!.run('/graph src/a.ts', signal);
        expect(show).toHaveBeenCalledWith('repo', ['src:repo::src/a.ts']);
        expect(out?.chips).toHaveLength(1);
    });

    it('builds the Open-in-graph chip from the root and the focus refs', () => {
        const shown = graphShown('opened', 'repo', ['src:repo::a.ts']);
        expect(shown.chip).toEqual({ labelKey: 'prefetch.chip.openInGraph', command: 'builderforce.openKnowledgeGraph', args: { rootId: 'repo', focus: ['src:repo::a.ts'] } });
    });

    it('every example of the graph row matches one of its patterns', () => {
        const graph = KNOWLEDGE_PREFETCH_ROWS.find((r) => r.id === KNOWLEDGE_GRAPH)!;
        expect(graph.patterns).toHaveLength(4);
        for (const example of graph.examples ?? []) expect((graph.patterns ?? []).some((p) => p.test(example)), example).toBe(true);
    });

    it('reuses a previewed plan only for two minutes', async () => {
        const h = host();
        let now = 0;
        const ex = knowledgePrefetchExecutors(h, () => now)[KNOWLEDGE_REVIEW_DIR]!;
        await ex.preview!('/review docs', signal);
        now = 119_000;
        await ex.preview!('/review docs', signal);
        expect(h.plans).toBe(1);
        now = 121_000 + 119_000;
        await ex.preview!('/review docs', signal);
        expect(h.plans).toBe(2);
    });
});

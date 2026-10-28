import { describe, expect, it, vi } from 'vitest';
import type { ReviewPlan, ReviewReport } from '@seanhogg/builderforce-memory/knowledge';
import {
    KNOWLEDGE_GRAPH, KNOWLEDGE_PREFETCH_ROWS, KNOWLEDGE_REVIEW_DIR, graphFocusOf, knowledgePrefetchExecutors, reviewTargetOf,
    type KnowledgeRowsHost,
} from './knowledgeRows.js';

const PLAN: ReviewPlan = {
    rootId: 'repo/contracts', files: 12, byPack: { code: 8, docs: 4 }, unchanged: 5, changed: [], removed: [], skipped: [], estimatedModelCalls: 37,
};
const REPORT: ReviewReport = {
    rootId: 'repo/contracts', digest: 'd', extracted: 7, judged: 30, unjudged: 0, invalidJudgements: 0, factsWritten: 9,
    relationsWritten: 4, staleMarked: 7, aborted: false, durationMs: 5,
};

function host(): KnowledgeRowsHost & { opened: string[]; plans: number; shown: Array<[string, string[]]> } {
    const h = {
        opened: [] as string[],
        plans: 0,
        shown: [] as Array<[string, string[]]>,
        async openReview(dir: string) {
            h.opened.push(dir);
            if (dir === 'missing') return null;
            return {
                rootId: dir ? `repo/${dir}` : 'repo',
                title: dir || 'repo',
                plan: async () => { h.plans += 1; return PLAN; },
                review: async () => REPORT,
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

    it('opens the graph focused on the files the request names', async () => {
        const h = host();
        const show = vi.spyOn(h, 'showGraph');
        const out = await knowledgePrefetchExecutors(h)[KNOWLEDGE_GRAPH]!.run('/graph src/a.ts', signal);
        expect(show).toHaveBeenCalledWith('repo', ['src:repo::src/a.ts']);
        expect(out?.chips).toHaveLength(1);
    });
});

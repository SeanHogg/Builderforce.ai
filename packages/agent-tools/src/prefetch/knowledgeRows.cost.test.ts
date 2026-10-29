import { describe, expect, it } from 'vitest';
import type { PlanDetail, ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';
import { planDetailOf } from '../knowledge/codeFixtures.test-util.js';
import { KNOWLEDGE_REVIEW_DIR, knowledgePrefetchExecutors, type KnowledgeRowsHost } from './knowledgeRows.js';

const PLAN: ReviewPlan = {
    rootId: 'repo', files: 12, byPack: { docs: 12 }, unchanged: 0, changed: [], removed: [], skipped: [], estimatedModelCalls: 10,
};
const DETAIL: PlanDetail = planDetailOf(PLAN);

const host = (callPrice?: KnowledgeRowsHost['callPrice']): KnowledgeRowsHost => ({
    openReview: async () => ({ rootId: 'repo', title: 'repo', plan: async () => DETAIL, review: async () => { throw new Error('unused'); } }),
    rootId: () => 'repo',
    showGraph: async () => ({ text: '' }),
    ...(callPrice ? { callPrice } : {}),
});
const preview = (h: KnowledgeRowsHost) => knowledgePrefetchExecutors(h)[KNOWLEDGE_REVIEW_DIR]!.preview!('/review docs', new AbortController().signal);

describe('knowledge.review-dir confirm chip: ≈ cost', () => {
    it('appends the ≈ cost when the host can price a call', async () => {
        expect(await preview(host(async () => ({ perCallUsd: 0.02, local: false })))).toBe('repo: 12 files (docs 12) · 0 unchanged · ≈ 10 model calls · ≈ $0.20');
    });

    it('appends the local note for a local engine', async () => {
        expect(await preview(host(async () => ({ perCallUsd: 0, local: true })))).toContain('runs on your local model — no cost');
    });

    it('states calls only when the host has no price', async () => {
        expect(await preview(host())).toBe('repo: 12 files (docs 12) · 0 unchanged · ≈ 10 model calls');
    });
});

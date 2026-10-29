import { describe, expect, it } from 'vitest';
import {
    KNOWLEDGE_FOCUS_PARAM, KNOWLEDGE_INTENT_PARAMS, KNOWLEDGE_REVIEW_PARAM, MAX_URL_FOCUS, knowledgeIntentFromQuery, knowledgeSurfaceQuery,
} from './knowledgeSurfaceLink.js';

describe('the knowledge surface URL contract', () => {
    it('writes what it reads', () => {
        const query = knowledgeSurfaceQuery(['src:r::a.ts', 'src:r::b.ts'], true);
        expect(new URLSearchParams(query).get('surface')).toBe('knowledge');
        expect(knowledgeIntentFromQuery(`?${query}`)).toEqual({ focus: ['src:r::a.ts', 'src:r::b.ts'], review: true });
        expect(knowledgeIntentFromQuery(knowledgeSurfaceQuery())).toEqual({ focus: [], review: false });
        expect(KNOWLEDGE_INTENT_PARAMS).toEqual([KNOWLEDGE_FOCUS_PARAM, KNOWLEDGE_REVIEW_PARAM]);
    });

    it('keeps the URL short and survives a hand-edited param', () => {
        const many = Array.from({ length: 60 }, (_, i) => `src:r::f${i}.ts`);
        expect(knowledgeIntentFromQuery(knowledgeSurfaceQuery(many)).focus).toHaveLength(MAX_URL_FOCUS);
        expect(knowledgeIntentFromQuery(`?${KNOWLEDGE_FOCUS_PARAM}=%7Bnope`)).toEqual({ focus: [], review: false });
        expect(knowledgeIntentFromQuery('')).toEqual({ focus: [], review: false });
    });
});

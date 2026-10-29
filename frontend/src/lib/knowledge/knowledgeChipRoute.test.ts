import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_FOCUS_PARAM, MAX_URL_FOCUS, knowledgeIntentFromQuery } from '@builderforce/agent-tools/prefetch';
import { knowledgeSurfaceHref, webChipHref } from './knowledgeChipRoute';

const GRAPH = 'builderforce.openKnowledgeGraph';
const REVIEW = 'builderforce.openKnowledgeReview';

describe('web knowledge chip routing', () => {
  it('opens the canvas knowledge surface focused on an Open-in-graph chip', () => {
    const href = webChipHref({ command: GRAPH, args: { rootId: 'web:vfs:7', focus: ['src:web:vfs:7::a.ts'] } }, 7)!;
    expect(href.startsWith('/projects/7?')).toBe(true);
    const query = new URLSearchParams(href.slice(href.indexOf('?')));
    expect(query.get('surface')).toBe('knowledge');
    expect(knowledgeIntentFromQuery(href.slice(href.indexOf('?')))).toEqual({ focus: ['src:web:vfs:7::a.ts'], review: false });
  });

  it('opens the review launcher for a Choose-a-folder chip', () => {
    const href = webChipHref({ command: REVIEW, args: { dir: 'contracts' } }, 7)!;
    expect(knowledgeIntentFromQuery(href.slice(href.indexOf('?')))).toEqual({ focus: [], review: true });
  });

  it('routes nothing that is not a knowledge chip, or with no project', () => {
    expect(webChipHref({ command: 'builderforce.somethingElse' }, 7)).toBeUndefined();
    expect(webChipHref({ command: GRAPH, args: { focus: [] } }, null)).toBeUndefined();
  });

  it('keeps the URL short and survives a hand-edited param', () => {
    const many = Array.from({ length: 60 }, (_, i) => `src:r::f${i}.ts`);
    const href = knowledgeSurfaceHref(1, { focus: many, review: false });
    expect(knowledgeIntentFromQuery(href.slice(href.indexOf('?'))).focus).toHaveLength(MAX_URL_FOCUS);
    expect(knowledgeIntentFromQuery(`?${KNOWLEDGE_FOCUS_PARAM}=%7Bnope`)).toEqual({ focus: [], review: false });
    expect(knowledgeIntentFromQuery('')).toEqual({ focus: [], review: false });
  });
});

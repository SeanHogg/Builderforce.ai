import { describe, expect, it } from 'vitest';
import { srcRef } from '@seanhogg/builderforce-memory/knowledge';
import { OPEN_IN_GRAPH_LABEL_KEY, OPEN_KNOWLEDGE_GRAPH_COMMAND } from '../../prefetch/codePackExecutors.js';
import { createHostKnowledgeIndex } from './hostIndex.js';
import { KNOWLEDGE_ASK, KNOWLEDGE_ASK_ROW, knowledgeAskExecutor, knowledgeSubject } from './knowledgeAsk.js';
import { hitConfidence, renderKnowledgeContext } from './renderHits.js';
import { seedCodeCards } from './seedCode.js';
import { manualIdle, WORKSPACE_FILES } from './testkit.test-util.js';

const ROOT = 'repo';
const signal = () => new AbortController().signal;

async function seeded() {
    const index = createHostKnowledgeIndex({ rootId: ROOT, idle: manualIdle() });
    await seedCodeCards(index, WORKSPACE_FILES);
    return index;
}

describe('knowledge.ask — the row', () => {
    it.each([
        ['where is billing handled', 'billing'],
        ['which file owns the retryPolicy?', 'retryPolicy'],
        ['what does the README say about deploys', 'README deploys'],
        ['where do we retry failed requests?', 'retry failed requests'],
        ['which specs mention SSO', 'SSO'],
    ])('reads the subject of "%s"', (request, subject) => {
        expect(knowledgeSubject(request)).toBe(subject);
        expect(KNOWLEDGE_ASK_ROW.patterns!.some((re) => re.test(request))).toBe(true);
    });

    it('is a read-only answer row, labelled in the host catalogs', () => {
        expect(KNOWLEDGE_ASK_ROW).toMatchObject({ id: KNOWLEDGE_ASK, kind: 'answer', sideEffect: 'read', labelKey: 'prefetch.action.knowledge.ask' });
        expect(knowledgeSubject('make this better')).toBeUndefined();
    });
});

describe('knowledge.ask — the executor', () => {
    it('an exact hit is certain (confidence 1), with the Open-in-graph chip focused on it', async () => {
        const index = await seeded();
        const out = await knowledgeAskExecutor({ index: async () => index }).run('which file owns the retryPolicy?', signal());
        expect(out?.confidence).toBe(1);
        expect(out?.text).toContain('`src/net/retryPolicy.ts`');
        expect(out?.chips).toEqual([{ labelKey: OPEN_IN_GRAPH_LABEL_KEY, command: OPEN_KNOWLEDGE_GRAPH_COMMAND, args: { rootId: ROOT, focus: expect.arrayContaining([srcRef(ROOT, 'src/net/retryPolicy.ts')]) } }]);
        expect(out?.data).toMatchObject({ top: 'exact', tiers: ['exact', 'lexical'] });
        expect(typeof out?.data?.digest).toBe('string');
    });

    it('an ambiguous question is short of an answer: low confidence, the hits as PREFETCH context', async () => {
        const index = await seeded();
        const out = await knowledgeAskExecutor({ index: async () => index }).run('where is billing handled', signal());
        expect(out).toBeDefined();
        expect(out!.confidence!).toBeLessThan(0.9);
        expect(out!.context).toContain('## Knowledge index');
        expect(out!.context).toContain('src/billing/');
    });

    it('answers nothing without an index or without hits', async () => {
        expect(await knowledgeAskExecutor({ index: async () => undefined }).run('where is billing handled', signal())).toBeUndefined();
        const index = await seeded();
        expect(await knowledgeAskExecutor({ index: async () => index }).run('where is zzqx handled', signal())).toBeUndefined();
    });

    it('`/ask` takes the rest of the line as the query', async () => {
        const index = await seeded();
        const out = await knowledgeAskExecutor({ index: async () => index }).run('/ask createInvoice', signal());
        expect(out?.confidence).toBe(1);
        expect(out?.text).toContain('src/billing/invoice.ts');
    });
});

describe('hit confidence and rendering', () => {
    it('exact is 1; one fused tier alone is at most half; two agreeing tiers reach 1', () => {
        expect(hitConfidence([{ id: 'a', score: 1, tier: 'exact' }], ['exact', 'lexical'])).toBe(1);
        expect(hitConfidence([{ id: 'a', score: 1 / 61, tier: 'lexical' }], ['exact', 'lexical'])).toBeCloseTo(0.5);
        expect(hitConfidence([{ id: 'a', score: 2 / 61, tier: 'lexical' }], ['exact', 'lexical', 'dense'])).toBeCloseTo(1);
        expect(hitConfidence([], ['exact'])).toBe(0);
    });

    it('leaves out files already in the turn', () => {
        const hits = [{ id: 'src:r::a.ts', score: 1, tier: 'exact' as const, path: 'a.ts' }, { id: 'src:r::b.ts', score: 0.5, tier: 'lexical' as const, path: 'b.ts' }];
        const block = renderKnowledgeContext('q', hits, ['exact', 'lexical'], { exclude: new Set(['a.ts']) });
        expect(block).toContain('`b.ts`');
        expect(block).not.toContain('`a.ts`');
        expect(renderKnowledgeContext('q', hits, ['exact'], { exclude: new Set(['a.ts', 'b.ts']) })).toBe('');
    });
});

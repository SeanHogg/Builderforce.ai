import { describe, it, expect } from 'vitest';
import { selectRecallContext, chunkDocuments, ingestAgentKnowledge, normalizeRecallQuery, recallAgentKnowledge, type KnowledgeChunk } from './agentKnowledge';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';

const chunks: KnowledgeChunk[] = [
  { id: 'a', text: 'Refunds are issued within a 30 day window from purchase.' },
  { id: 'b', text: 'Our office is open Monday to Friday, nine to five.' },
  { id: 'c', text: 'To request a refund, email support with your order id.' },
];

describe('selectRecallContext (BM25 recall)', () => {
  it('returns the chunks relevant to the query, most relevant first', () => {
    const out = selectRecallContext('how do I get a refund?', chunks);
    expect(out).toContain('refund');
    // The unrelated office-hours chunk has no query-term overlap → dropped.
    expect(out).not.toContain('Monday to Friday');
  });

  it('respects topK', () => {
    const out = selectRecallContext('refund', chunks, 1);
    expect(out.split('\n\n')).toHaveLength(1);
  });

  it('returns empty string for an empty query, no chunks, or no overlap', () => {
    expect(selectRecallContext('', chunks)).toBe('');
    expect(selectRecallContext('refund', [])).toBe('');
    expect(selectRecallContext('zzzz nonexistent term', chunks)).toBe('');
  });
});

describe('chunkDocuments', () => {
  it('splits documents into non-empty chunk texts', () => {
    const out = chunkDocuments([{ text: 'Hello world.' }, { text: '   ' }, { text: 'Another doc.' }]);
    expect(out).toEqual(['Hello world.', 'Another doc.']);
  });

  it('chunks a long document into multiple pieces', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} with some filler words to add length.`).join(' ');
    const out = chunkDocuments([{ text: long }]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((t) => t.trim().length > 0)).toBe(true);
  });
});

/** A Drizzle double over one agent's chunk rows: the chunk read, the agent lookup, and
 *  ingest's replace (delete + insert). Counts chunk reads. */
function chunkDb(initial: KnowledgeChunk[]) {
  const state = { rows: initial.map((c) => ({ id: c.id, chunkText: c.text })), chunkReads: 0 };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => {
            state.chunkReads++;
            return state.rows;
          },
          limit: async () => [{ tenantId: 1 }],
        }),
      }),
    }),
    delete: () => ({ where: async () => { state.rows = []; } }),
    insert: () => ({
      values: async (v: Array<{ id: string; chunkText: string }>) => {
        state.rows = v.map((r) => ({ id: r.id, chunkText: r.chunkText }));
      },
    }),
  };
  return { db: db as never, state };
}

describe('recallAgentKnowledge — memoised per (agent, query, version)', () => {
  const env = {} as never;

  it('returns byte-identical recall across a tool loop even when the chunk set changes underneath', async () => {
    const { db, state } = chunkDb(chunks);
    const first = await recallAgentKnowledge(env, db, 1, 'agent-a', 'how do I get a refund?');
    expect(first).toContain('refund');
    // The chunk cache refreshes mid-loop (TTL / an expired chunk) with a different set.
    state.rows = [{ id: 'z', chunkText: 'Refund policy rewritten entirely.' }];
    await invalidateCached(env, 'agent_knowledge:chunks:1:agent-a');
    // Whitespace / case variants of the same user message share the memo.
    expect(await recallAgentKnowledge(env, db, 1, 'agent-a', '  How do I get a   REFUND? ')).toBe(first);
    expect(state.chunkReads).toBe(1);
  });

  it('an ingest bumps the version token, so the next recall reflects the new knowledge', async () => {
    const { db } = chunkDb(chunks);
    const before = await recallAgentKnowledge(env, db, 1, 'agent-b', 'refund');
    // Recall scores whole words (no stemming), so the new text says "refund", as the query does.
    await ingestAgentKnowledge(env, db, 1, 'agent-b', [{ text: 'A refund now takes 90 days.' }]);
    const after = await recallAgentKnowledge(env, db, 1, 'agent-b', 'refund');
    expect(after).not.toBe(before);
    expect(after).toContain('90 days');
  });

  it('keys per agent and treats an empty query as no recall', async () => {
    const { db, state } = chunkDb(chunks);
    await recallAgentKnowledge(env, db, 1, 'agent-c', 'refund');
    await recallAgentKnowledge(env, db, 1, 'agent-d', 'refund');
    expect(state.chunkReads).toBe(2);
    expect(await recallAgentKnowledge(env, db, 1, 'agent-c', '   ')).toBe('');
    expect(normalizeRecallQuery('  A   b ')).toBe('a b');
  });
});

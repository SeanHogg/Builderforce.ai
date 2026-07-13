import { describe, it, expect } from 'vitest';
import { selectRecallContext, chunkDocuments, type KnowledgeChunk } from './agentKnowledge';

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

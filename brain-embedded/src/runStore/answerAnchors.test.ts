import { describe, expect, it } from 'vitest';
import { MAX_ANSWER_ANCHORS, readFileAnchors } from './answerAnchors';
import type { BrainTraceEvent } from '../brainTriage';

const tool = (label: string, args: unknown, isError = false): BrainTraceEvent => ({
  ts: '2026-10-22T00:00:00Z', category: 'tool', label, args, ...(isError ? { isError } : {}),
});

describe('readFileAnchors', () => {
  it('keeps each successfully read file once, normalized, in read order', () => {
    expect(readFileAnchors([
      tool('read_file', { path: './api/src/auth.ts', offset: 1 }),
      tool('read_file', { path: 'api/src/auth.ts', offset: 140 }),
      tool('read_file', { path: 'api\\src\\db.ts' }),
    ])).toEqual([{ path: 'api/src/auth.ts' }, { path: 'api/src/db.ts' }]);
  });

  it('ignores failed reads, non-read tools and non-tool steps', () => {
    expect(readFileAnchors([
      tool('read_file', { path: 'missing.ts' }, true),
      tool('edit_file', { path: 'a.ts' }),
      tool('search_code', { query: 'x', path: 'src' }),
      { ts: 't', category: 'llm', label: 'llm.complete', args: { path: 'x.ts' } },
    ])).toEqual([]);
  });

  it('reads multi-file calls and is bounded', () => {
    const many = Array.from({ length: 40 }, (_, i) => `f${i}.ts`);
    const out = readFileAnchors([tool('read_files', { paths: many })]);
    expect(out).toHaveLength(MAX_ANSWER_ANCHORS);
    expect(out[0]).toEqual({ path: 'f0.ts' });
  });
});

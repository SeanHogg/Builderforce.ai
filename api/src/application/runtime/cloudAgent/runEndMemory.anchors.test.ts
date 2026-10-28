/**
 * PRD 38 §4.10 — a run-end durable fact that names files is ANCHORED to them, with the
 * file's content hash when the run knows it, so it joins the knowledge graph and goes
 * stale when the file changes. Driven through the real governed memory service down to
 * the one fact upsert.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../llm/projectFactsWrite', () => ({ upsertProjectFact: upsert, deleteProjectFact: vi.fn() }));

import { commitRunMemory, runFactAnchors } from './runEndMemory';

const base = { db: {} as never, env: {} as never, tenantId: 1, projectId: 2, ticketId: null, executionId: 7 };

beforeEach(() => upsert.mockClear());

describe('run-end fact anchors', () => {
  it('a project-scoped run fact naming a path stores its anchor with the known hash', async () => {
    const ok = await commitRunMemory({
      ...base,
      summary: 'Moved the retry policy out of src/billing/charge.ts into docs/notes.md for review.',
      writtenPaths: ['src/billing/charge.ts'],
      writtenFileHashes: { 'src/billing/charge.ts': 'h-charge' },
    });
    expect(ok).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0] as unknown as [unknown, unknown, number, number, string, string, string, Record<string, unknown>];
    expect(call[2]).toBe(1);
    expect(call[3]).toBe(2);
    expect(call[4]).toBe('run-outcome:project-2:7');
    expect(call[7]).toMatchObject({
      fileAnchors: [{ path: 'src/billing/charge.ts', contentHash: 'h-charge' }, { path: 'docs/notes.md' }],
      // A run outcome is not a single-subject belief: it must not retire other facts.
      retireByAnchor: false,
    });
  });

  it('reads paths with the shared extractor, deduped and normalised', () => {
    expect(runFactAnchors(['.\\src\\a.ts'], 'see src/a.ts and `README.md`.', { 'src/a.ts': 'h' })).toEqual([
      { path: 'src/a.ts', contentHash: 'h' },
      { path: 'README.md' },
    ]);
  });
});

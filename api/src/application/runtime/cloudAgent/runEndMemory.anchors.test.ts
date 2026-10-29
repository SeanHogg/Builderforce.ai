/**
 * PRD 38 §4.10 — a run-end durable fact that names files is ANCHORED to them, with the
 * file's content hash when the run knows it, so it joins the knowledge graph and goes
 * stale when the file changes. Driven through the real governed memory service down to
 * the ONE knowledge writer (`writeKnowledge`, PRD 38 §4.2): run-end memory is written as an
 * `agent` fact by a machine caller, never straight to the fact upsert.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const write = vi.hoisted(() => vi.fn(async () => ({ factsWritten: 1, relationsWritten: 0, staleMarked: 0 })));
vi.mock('../../knowledge/writeKnowledge', () => ({ writeKnowledge: write }));

import { commitRunMemory, runFactAnchors } from './runEndMemory';

const base = { db: {} as never, env: {} as never, tenantId: 1, projectId: 2, ticketId: null, executionId: 7 };

beforeEach(() => write.mockClear());

describe('run-end fact anchors', () => {
  it('a project-scoped run fact naming a path stores its anchor with the known hash', async () => {
    const ok = await commitRunMemory({
      ...base,
      summary: 'Moved the retry policy out of src/billing/charge.ts into docs/notes.md for review.',
      writtenPaths: ['src/billing/charge.ts'],
      writtenFileHashes: { 'src/billing/charge.ts': 'h-charge' },
    });
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const [deps, input] = write.mock.calls[0] as unknown as [Record<string, unknown>, { facts: Array<Record<string, unknown>> }];
    expect(deps).toMatchObject({ tenantId: 1, projectId: 2, userId: null });
    expect(input.facts).toHaveLength(1);
    expect(input.facts[0]).toMatchObject({
      key: 'run-outcome:project-2:7',
      origin: 'agent',
      fileAnchors: [{ path: 'src/billing/charge.ts', contentHash: 'h-charge' }, { path: 'docs/notes.md' }],
    });
    // A run outcome is not a single-subject belief: it must not retire other facts.
    expect(deps.legacyFact).toMatchObject({ retireByAnchor: false });
  });

  it('writes the code map as a project-scope agent fact through the same writer', async () => {
    await commitRunMemory({
      ...base,
      summary: 'Mapped the billing module for the next run on this area.',
      writtenPaths: ['src/billing/charge.ts'],
      writtenFileHashes: { 'src/billing/charge.ts': 'h-charge' },
      codeMap: { key: 'codemap:src/billing', content: '- src/billing/charge.ts: charges' } as never,
    });
    expect(write).toHaveBeenCalledTimes(2);
    const [deps, input] = write.mock.calls[1] as unknown as [Record<string, unknown>, { facts: Array<Record<string, unknown>> }];
    expect(deps).toMatchObject({ projectId: 2, userId: null });
    expect(input.facts[0]).toMatchObject({ key: 'codemap:src/billing', origin: 'agent' });
  });

  it('reads paths with the shared extractor, deduped and normalised', () => {
    expect(runFactAnchors(['.\\src\\a.ts'], 'see src/a.ts and `README.md`.', { 'src/a.ts': 'h' })).toEqual([
      { path: 'src/a.ts', contentHash: 'h' },
      { path: 'README.md' },
    ]);
  });
});

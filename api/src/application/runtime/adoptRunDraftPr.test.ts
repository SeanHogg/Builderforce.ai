/**
 * The finalize's side of the early draft: the platform's own draft (read from the durable record) is taken out of
 * draft, retitled and adopted; a PR a human opened has no such record and is not touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  find: vi.fn(),
  open: vi.fn(async (..._a: unknown[]) => undefined),
  ready: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: true } | { ok: false; reason: string }),
  record: vi.fn(async (..._a: unknown[]) => undefined),
  report: vi.fn(),
  recordRow: vi.fn(async (..._a: unknown[]) => ({ id: 'row-9' })),
}));
vi.mock('../repos/platformDraftPullRequest', () => ({ findPlatformDraftPullRequest: h.find, markPlatformDraftOpen: h.open, PLATFORM_DRAFT_STATUS: 'draft' }));
vi.mock('../repos/recordTaskPullRequest', () => ({ recordTaskPullRequest: h.recordRow }));
vi.mock('../repos/createPullRequest', () => ({ markReadyForReview: h.ready }));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: h.report }));

import { adoptRunDraftPr } from './adoptRunDraftPr';

const db = {} as never;
const text = { title: 'Task #3: t', body: 'final body' };
const args = {
  tenantId: 1, cloudAgentRef: undefined, executionId: 9, taskId: 3, text,
  repoCtx: { provider: 'github', host: null, owner: 'o', repo: 'r', token: 't', branch: 'bf/task-3', repoId: 'repo-1', segmentId: 'seg', projectId: 2, base: 'main' },
};
const draft = { id: 'row-1', number: 7, url: 'https://x/pull/7', status: 'draft' };

beforeEach(() => vi.clearAllMocks());

describe('adoptRunDraftPr', () => {
  it('adopts the platform draft: ready for review with the finalize text, the row opened, the PR handed back', async () => {
    h.find.mockResolvedValueOnce(draft);
    expect(await adoptRunDraftPr(db, args)).toEqual({ number: 7, url: 'https://x/pull/7', rowId: 'row-1' });
    expect(h.find).toHaveBeenCalledWith(db, { tenantId: 1, taskId: 3, repoId: 'repo-1', branch: 'bf/task-3' });
    expect(h.ready).toHaveBeenCalledWith(expect.objectContaining({ number: 7, owner: 'o', text }));
    expect(h.open).toHaveBeenCalledWith(db, 1, 'row-1', true);
    expect(h.record).toHaveBeenCalledWith(db, expect.objectContaining({ toolName: 'pr_ready_for_review' }));
  });

  it('adopts a draft an EARLIER execution of the task opened (the match is task + branch + stamp, not execution)', async () => {
    h.find.mockResolvedValueOnce(draft);
    expect(await adoptRunDraftPr(db, { ...args, executionId: 42 })).toMatchObject({ number: 7 });
  });

  it('regression: M3 - when marking ready fails the row still flips to open, the failure is reported, the PR is adopted', async () => {
    h.find.mockResolvedValueOnce(draft);
    h.ready.mockResolvedValueOnce({ ok: false, reason: 'graphql error' });
    expect(await adoptRunDraftPr(db, args)).toMatchObject({ number: 7 });
    expect(h.open).toHaveBeenCalledWith(db, 1, 'row-1', false); // marker kept: the sweep may retry
    expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('graphql error') }), expect.objectContaining({ operation: 'markReadyForReview' }));
    expect(h.record.mock.calls[0]![1]).toMatchObject({ result: expect.stringContaining('left as a draft') });
  });

  it('regression: a human marked the draft ready before finish (row open) - it is still adopted and given the final text', async () => {
    h.find.mockResolvedValueOnce({ ...draft, status: 'open' });
    expect(await adoptRunDraftPr(db, args)).toMatchObject({ number: 7, rowId: 'row-1' });
    expect(h.ready).toHaveBeenCalledWith(expect.objectContaining({ number: 7, text }));
  });

  it('regression: a dead claim\'s own unrecorded draft (resolved by the finalize create) is recorded as the platform draft, then marked ready with the final text', async () => {
    h.find.mockResolvedValueOnce(null);
    const out = await adoptRunDraftPr(db, { ...args, recovered: { number: 11, url: 'https://x/pull/11' } });
    expect(out).toEqual({ number: 11, url: 'https://x/pull/11', rowId: 'row-9' });
    expect(h.recordRow).toHaveBeenCalledWith(db, expect.objectContaining({ number: 11, status: 'draft', taskId: 3, repoId: 'repo-1', platformDraftExecutionId: 9 }));
    expect(h.ready).toHaveBeenCalledWith(expect.objectContaining({ number: 11, text }));
    expect(h.open).toHaveBeenCalledWith(db, 1, 'row-9', true);
  });

  it('a failing timeline write after the record does not turn the adoption into "no draft"', async () => {
    h.find.mockResolvedValueOnce(draft);
    h.record.mockRejectedValueOnce(new Error('telemetry down'));
    expect(await adoptRunDraftPr(db, args)).toMatchObject({ number: 7, rowId: 'row-1' });
    expect(h.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'adoptRunDraftPr' }));
  });

  it('does not adopt a PR with no platform-draft record (a human\'s PR stays a lost claim)', async () => {
    h.find.mockResolvedValueOnce(null);
    expect(await adoptRunDraftPr(db, args)).toBeNull();
    expect(h.ready).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });
});

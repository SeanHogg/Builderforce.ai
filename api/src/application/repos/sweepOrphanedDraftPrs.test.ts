/**
 * The orphan sweep settles a platform draft by how its task's last run ENDED: a dead run (failed, cancelled, reaped)
 * is closed and never readied; a succeeded run that the finalize never adopted is readied with the final text. A draft
 * whose task still has a live (or just-ended) run, or a PR with no marker, is left alone.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  outcome: vi.fn(),
  commits: vi.fn(),
  close: vi.fn(async (..._a: unknown[]) => ({ ok: true, closed: true }) as { ok: true; closed: boolean } | { ok: false; code: string; reason: string }),
  ready: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: true } | { ok: false; reason: string }),
  opened: vi.fn(async (..._a: unknown[]) => undefined),
  retire: vi.fn(async (..._a: unknown[]) => ({ claimedAt: null }) as { claimedAt: Date | null } | null),
  restore: vi.fn(async (..._a: unknown[]) => undefined),
  live: vi.fn(async (..._a: unknown[]) => false),
  record: vi.fn(async (..._a: unknown[]) => ({ id: 'new-row' })),
  release: vi.fn(async (..._a: unknown[]) => undefined),
  lookup: vi.fn(),
  defaultRepo: vi.fn(),
  resolve: vi.fn(),
  report: vi.fn(),
}));
vi.mock('./orphanRunOutcome', () => ({ draftRunOutcome: h.outcome, ORPHAN_DRAFT_GRACE_MS: 1_800_000 }));
vi.mock('../runtime/liveExecutionStatus', () => ({ taskHasLiveRun: h.live, LIVE_EXECUTION_STATUSES: ['pending', 'submitted', 'running', 'paused'] }));
vi.mock('./branchLifecycle', () => ({ listBranchCommits: h.commits, closePullRequest: h.close }));
vi.mock('./createPullRequest', () => ({ markReadyForReview: h.ready, lookupOpenPullRequest: h.lookup }));
vi.mock('./platformDraftPullRequest', () => ({ markPlatformDraftOpen: h.opened, retirePlatformDraft: h.retire, restorePlatformDraft: h.restore, PLATFORM_DRAFT_STATUS: 'draft' }));
vi.mock('./recordTaskPullRequest', () => ({ recordTaskPullRequest: h.record }));
vi.mock('./openTaskPullRequest', () => ({ releaseTaskPrClaim: h.release, prClaimStaleBefore: () => new Date(0) }));
vi.mock('./resolveDefaultRepo', () => ({ resolveDefaultRepoForTask: h.defaultRepo }));
vi.mock('./resolveRepoCredential', () => ({ resolveRepoCredential: h.resolve, isResolveError: (v: { error?: string }) => 'error' in v }));
vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: h.report }));

import { sweepOrphanedDraftPullRequests } from './sweepOrphanedDraftPrs';

const draft = { id: 'row-1', tenantId: 1, taskId: 3, taskTitle: 'Fix it', repoId: 'repo-1', number: 7, url: 'https://x/pull/7', branch: 'builderforce/task-3', base: 'main', draftExecutionId: 50, status: 'draft' };
const withCommits = { ok: true, commits: [{ sha: 'a', message: 'm', authorName: null }], truncated: false };
const noCommits = { ok: true, commits: [], truncated: false };

/** First select answers the marked drafts, the second the tasks holding a dead claim. */
const realBuilder = drizzle(new PGlite()) as unknown as { select: (...a: unknown[]) => Record<string, unknown> };
const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
/** The `where` condition of each top-level select, in order - what the SQL filters are asserted on. */
const wheres: unknown[] = [];

/** An answer is consumed when a select is AWAITED, so the sub-selects built inside a `where` (never awaited) take none. */
function fakeDb(drafts: unknown[], held: unknown[] = []) {
  const answers = [drafts, held];
  return {
    // A REAL (never-connected) query builder, so the statement's SQL can be rendered and asserted; only its `then` is replaced.
    select: (...args: unknown[]) => {
      const builder = realBuilder.select(...args);
      const where = (builder.where as (c: unknown) => unknown).bind(builder);
      let cond: unknown;
      builder.where = (c: unknown) => { cond = c; return where(c); };
      builder.then = (res: (v: unknown) => unknown) => { wheres.push(cond); return Promise.resolve(answers.shift() ?? []).then(res); };
      return builder;
    },
    update: (table: unknown) => ({ set: (set: Record<string, unknown>) => ({ where: async () => { updates.push({ table, set }); } }) }),
  } as never;
}

const render = (cond: unknown): string => new PgDialect().sqlToQuery(cond as never).sql;

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  wheres.length = 0;
  h.live.mockResolvedValue(false);
  h.retire.mockResolvedValue({ claimedAt: null });
  h.resolve.mockResolvedValue({ repo: { provider: 'github', host: null, owner: 'o', repo: 'r', defaultBranch: 'main', segmentId: 's', projectId: 2 }, token: 't' });
});

describe('sweepOrphanedDraftPullRequests - by how the last run ended', () => {
  it('regression: MAJOR 2 - a CANCELLED/FAILED run\'s draft is closed even though its branch has commits, and never readied', async () => {
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue(withCommits);
    const out = await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(out).toEqual({ checked: 1, readied: 0, closed: 1, skipped: 0 });
    expect(h.close).toHaveBeenCalledWith(expect.objectContaining({ number: 7, owner: 'o' }));
    expect(h.retire).toHaveBeenCalledWith(expect.anything(), 1, { rowId: 'row-1', taskId: 3, number: 7, executionId: 50 });
    expect(h.ready).not.toHaveBeenCalled();
  });

  it('regression: MAJOR 2 - a SUCCEEDED run\'s draft the finalize never adopted is readied with the final text, and the marker cleared', async () => {
    h.outcome.mockResolvedValue('succeeded');
    h.commits.mockResolvedValue(withCommits);
    const out = await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(out).toEqual({ checked: 1, readied: 1, closed: 0, skipped: 0 });
    expect(h.ready).toHaveBeenCalledWith(expect.objectContaining({ number: 7, text: expect.objectContaining({ title: 'Task #3: Fix it' }) }));
    expect(h.opened).toHaveBeenCalledWith(expect.anything(), 1, 'row-1', true, 50);
    expect(h.close).not.toHaveBeenCalled();
  });

  it('a succeeded run with nothing on its branch has nothing to review: the draft is closed', async () => {
    h.outcome.mockResolvedValue('succeeded');
    h.commits.mockResolvedValue(noCommits);
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]))).toMatchObject({ closed: 1, readied: 0 });
  });

  it('keeps the marker when marking ready fails, and reports it', async () => {
    h.outcome.mockResolvedValue('succeeded');
    h.commits.mockResolvedValue(withCommits);
    h.ready.mockResolvedValueOnce({ ok: false, reason: 'graphql' });
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(h.opened).toHaveBeenCalledWith(expect.anything(), 1, 'row-1', false, 50);
    expect(h.report).toHaveBeenCalled();
  });

  describe('regression: M-A - a failed mark-ready (row open + marker kept) is retried', () => {
    const failedReady = { ...draft, status: 'open' };
    beforeEach(() => { h.outcome.mockResolvedValue('succeeded'); h.commits.mockResolvedValue(withCommits); });

    it('the recorded query selects open + marker rows as well as drafts (both statuses are BOUND values)', async () => {
      await sweepOrphanedDraftPullRequests({} as never, fakeDb([]));
      const q = new PgDialect().sqlToQuery(wheres[0] as never);
      expect(q.sql.toLowerCase()).toContain('"status" in');
      expect(q.sql.toLowerCase()).toContain('platform_draft_execution_id" is not null');
      expect(q.params).toEqual(expect.arrayContaining(['draft', 'open']));
    });

    it('open + marker -> mark-ready is called again STATUS-ONLY (no title/body: a human may own the text) -> the marker is cleared', async () => {
      const out = await sweepOrphanedDraftPullRequests({} as never, fakeDb([failedReady]));
      expect(out).toMatchObject({ readied: 1, closed: 0 });
      expect(h.ready).toHaveBeenCalledTimes(1);
      const sent = h.ready.mock.calls[0]![0] as Record<string, unknown>;
      expect(sent).toMatchObject({ number: 7 });
      expect(sent).not.toHaveProperty('text');
      expect(h.opened).toHaveBeenCalledWith(expect.anything(), 1, 'row-1', true, 50);
    });

    it('a dead opener, or a succeeded one with nothing on the branch, gives up ownership: the marker is cleared, nothing is sent', async () => {
      h.outcome.mockResolvedValue('dead');
      await sweepOrphanedDraftPullRequests({} as never, fakeDb([failedReady]));
      expect(h.opened).toHaveBeenLastCalledWith(expect.anything(), 1, 'row-1', true, 50);
      h.opened.mockClear();
      h.outcome.mockResolvedValue('succeeded');
      h.commits.mockResolvedValue(noCommits);
      await sweepOrphanedDraftPullRequests({} as never, fakeDb([failedReady]));
      expect(h.opened).toHaveBeenLastCalledWith(expect.anything(), 1, 'row-1', true, 50);
      expect(h.ready).not.toHaveBeenCalled();
      expect(h.close).not.toHaveBeenCalled();
    });

    it('a retry that fails again keeps the marker for the next tick', async () => {
      h.ready.mockResolvedValueOnce({ ok: false, reason: 'graphql' });
      await sweepOrphanedDraftPullRequests({} as never, fakeDb([failedReady]));
      expect(h.ready).toHaveBeenCalled();
      expect(h.opened).toHaveBeenCalledWith(expect.anything(), 1, 'row-1', false, 50);
    });

    it('an open marked row is never CLOSED, even when its opener died or left nothing', async () => {
      h.outcome.mockResolvedValue('dead');
      expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([failedReady]))).toMatchObject({ skipped: 1, closed: 0 });
      h.outcome.mockResolvedValue('succeeded');
      h.commits.mockResolvedValue(noCommits);
      expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([failedReady]))).toMatchObject({ skipped: 1, closed: 0 });
      expect(h.close).not.toHaveBeenCalled();
      expect(h.retire).not.toHaveBeenCalled();
    });
  });

  it('regression: the open-claim release is FENCED with the claim the CAS saw (a re-taken claim is not released), and skipped when there was none', async () => {
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue(noCommits);
    const seen = new Date('2026-01-01T00:00:00Z');
    h.retire.mockResolvedValueOnce({ claimedAt: seen });
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(h.release).toHaveBeenCalledWith(expect.anything(), 1, 3, seen);
    h.release.mockClear();
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft])); // claimedAt null
    expect(h.release).not.toHaveBeenCalled();
  });

  it('regression: Minor 4 - the task\'s open-claim is released only AFTER the provider close succeeded', async () => {
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue(noCommits);
    h.retire.mockResolvedValue({ claimedAt: new Date(1) });
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(h.release).toHaveBeenCalledWith(expect.anything(), 1, 3, new Date(1));
    h.release.mockClear();
    h.close.mockResolvedValueOnce({ ok: false, code: 'provider_error', reason: '500' });
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(h.release).not.toHaveBeenCalled();
  });

  it.each(['live', 'recent', 'none'])('leaves a draft alone while its task\'s last run is %s', async (state) => {
    h.outcome.mockResolvedValue(state);
    const out = await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(out).toEqual({ checked: 1, readied: 0, closed: 0, skipped: 1 });
    expect(h.close).not.toHaveBeenCalled();
    expect(h.ready).not.toHaveBeenCalled();
  });

  it('leaves a draft whose branch cannot be read for the next pass (never closes on missing evidence)', async () => {
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue({ ok: false, code: 'provider_error', reason: 'boom' });
    expect((await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]))).skipped).toBe(1);
    expect(h.close).not.toHaveBeenCalled();
  });

  it('keeps the draft when the provider refuses the close', async () => {
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue(noCommits);
    h.close.mockResolvedValueOnce({ ok: false, code: 'provider_error', reason: '500' });
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]))).toMatchObject({ closed: 0, skipped: 1 });
    // The row was won first and is put back, so a refused close never leaves an unmarked row beside an open draft.
    expect(h.retire).toHaveBeenCalled();
    expect(h.restore).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ rowId: 'row-1', executionId: 50, url: 'https://x/pull/7' }));
  });

  it('regression: M6 - a lost compare-and-set (the row was adopted or readied meanwhile) never closes the provider PR', async () => {
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue(noCommits);
    h.retire.mockResolvedValueOnce(null);
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]))).toMatchObject({ closed: 0, skipped: 1 });
    expect(h.close).not.toHaveBeenCalled();
    expect(h.restore).not.toHaveBeenCalled();
  });

  it('regression: M6 - a run that started while the credential and commits were being read stops the close AND the ready', async () => {
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue(noCommits);
    h.live.mockResolvedValueOnce(true);
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]))).toMatchObject({ closed: 0, skipped: 1 });
    h.outcome.mockResolvedValue('succeeded');
    h.commits.mockResolvedValue(withCommits);
    h.live.mockResolvedValueOnce(true);
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]))).toMatchObject({ readied: 0, skipped: 1 });
    expect(h.close).not.toHaveBeenCalled();
    expect(h.ready).not.toHaveBeenCalled();
    expect(h.retire).not.toHaveBeenCalled();
  });
});

describe('sweepOrphanedDraftPullRequests - candidates are chosen in SQL', () => {
  it('regression: M5 - the draft query itself excludes tasks with a live run and openers that have not ended past the grace, so live drafts cannot fill the batch', async () => {
    h.outcome.mockResolvedValue('none');
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([]));
    const sql = render(wheres[0]).toLowerCase();
    expect(sql).toContain('not exists');
    expect(sql).toContain('"executions"');
    expect(sql).toContain('draft_opener');
    expect(sql).toContain('coalesce');
  });

  it('regression: M5 - the held-claim query requires a tenant, no live run, and no examination within the grace', async () => {
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([]));
    const sql = render(wheres[1]).toLowerCase();
    expect(sql).toContain('"tenant_id" is not null');
    expect(sql).toContain('not exists');
    expect(sql).toContain('orphan_draft_checked_at');
  });

  it('regression: M5 - a draft examined and left rotates behind the queue, a held task is stamped checked, a settled draft is not touched', async () => {
    h.outcome.mockResolvedValue('recent');
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft], [{ id: 3, tenantId: 1, title: 'Fix it' }]));
    expect(updates.some((u) => 'updatedAt' in u.set)).toBe(true);
    expect(updates.some((u) => 'orphanDraftCheckedAt' in u.set)).toBe(true);
    updates.length = 0;
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue(noCommits);
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(updates).toHaveLength(0);
  });
});

describe('sweepOrphanedDraftPullRequests - a draft whose record never landed', () => {
  const held = [{ id: 3, tenantId: 1, title: 'Fix it' }];
  beforeEach(() => { h.defaultRepo.mockResolvedValue({ repoId: 'repo-1' }); h.outcome.mockResolvedValue('dead'); h.commits.mockResolvedValue(withCommits); });

  it('regression: Minor 4 - a held claim with no stamp is recovered through the provider and, being a platform draft of a dead run, closed with the claim released', async () => {
    h.lookup.mockResolvedValue({ number: 11, url: 'https://x/pull/11', draft: true, body: 'Draft opened by Coder for task #3 so the repository\'s pull_request CI builds this branch while the run is still in progress. It has no shell to build in.' });
    const out = await sweepOrphanedDraftPullRequests({} as never, fakeDb([], held));
    expect(out).toMatchObject({ closed: 1 });
    expect(h.close).toHaveBeenCalledWith(expect.objectContaining({ number: 11 }));
    expect(h.release).toHaveBeenCalledWith(expect.anything(), 1, 3);
  });

  it('regression: Minor 4 - a human\'s draft on that branch (a different body) is left alone', async () => {
    h.lookup.mockResolvedValue({ number: 11, url: 'https://x/pull/11', draft: true, body: 'WIP, do not touch' });
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([], held))).toMatchObject({ checked: 0, closed: 0 });
    expect(h.close).not.toHaveBeenCalled();
  });

  it('a non-draft PR on the branch is left alone, and a succeeded run\'s recovered draft is recorded as open and readied', async () => {
    h.lookup.mockResolvedValueOnce({ number: 11, url: 'https://x/pull/11', draft: false, body: 'x' });
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([], held))).toMatchObject({ checked: 0 });
    h.outcome.mockResolvedValue('succeeded');
    h.lookup.mockResolvedValueOnce({ number: 11, url: 'https://x/pull/11', draft: true, body: 'Draft opened by A for task #3 so the repository\'s pull_request CI builds this branch while the run is still in progress. It has no shell to build in.' });
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([], held))).toMatchObject({ readied: 1 });
    expect(h.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ number: 11, status: 'open', taskId: 3 }));
  });
});

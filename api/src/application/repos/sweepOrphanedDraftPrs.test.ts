/**
 * The orphan sweep settles a platform draft by how its task's last run ENDED: a dead run (failed, cancelled, reaped)
 * is closed and never readied; a succeeded run that the finalize never adopted is readied with the final text. A draft
 * whose task still has a live (or just-ended) run, or a PR with no marker, is left alone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  outcome: vi.fn(),
  commits: vi.fn(),
  close: vi.fn(async (..._a: unknown[]) => ({ ok: true, closed: true }) as { ok: true; closed: boolean } | { ok: false; code: string; reason: string }),
  ready: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: true } | { ok: false; reason: string }),
  opened: vi.fn(async (..._a: unknown[]) => undefined),
  retire: vi.fn(async (..._a: unknown[]) => undefined),
  record: vi.fn(async (..._a: unknown[]) => ({ id: 'new-row' })),
  release: vi.fn(async (..._a: unknown[]) => undefined),
  lookup: vi.fn(),
  defaultRepo: vi.fn(),
  resolve: vi.fn(),
  report: vi.fn(),
}));
vi.mock('./orphanRunOutcome', () => ({ lastRunOutcome: h.outcome, ORPHAN_DRAFT_GRACE_MS: 1_800_000 }));
vi.mock('./branchLifecycle', () => ({ listBranchCommits: h.commits, closePullRequest: h.close }));
vi.mock('./createPullRequest', () => ({ markReadyForReview: h.ready, lookupOpenPullRequest: h.lookup }));
vi.mock('./platformDraftPullRequest', () => ({ markPlatformDraftOpen: h.opened, retirePlatformDraft: h.retire, PLATFORM_DRAFT_STATUS: 'draft' }));
vi.mock('./recordTaskPullRequest', () => ({ recordTaskPullRequest: h.record }));
vi.mock('./openTaskPullRequest', () => ({ releaseTaskPrClaim: h.release, prClaimStaleBefore: () => new Date(0) }));
vi.mock('./resolveDefaultRepo', () => ({ resolveDefaultRepoForTask: h.defaultRepo }));
vi.mock('./resolveRepoCredential', () => ({ resolveRepoCredential: h.resolve, isResolveError: (v: { error?: string }) => 'error' in v }));
vi.mock('../integrations/integrationCredentialSecret', () => ({ integrationCredentialSecret: () => 'secret' }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: h.report }));

import { sweepOrphanedDraftPullRequests } from './sweepOrphanedDraftPrs';

const draft = { id: 'row-1', tenantId: 1, taskId: 3, taskTitle: 'Fix it', repoId: 'repo-1', number: 7, url: 'https://x/pull/7', branch: 'builderforce/task-3', base: 'main' };
const withCommits = { ok: true, commits: [{ sha: 'a', message: 'm', authorName: null }], truncated: false };
const noCommits = { ok: true, commits: [], truncated: false };

/** First select answers the marked drafts, the second the tasks holding a dead claim. */
function fakeDb(drafts: unknown[], held: unknown[] = []) {
  const answers = [drafts, held];
  return {
    select: () => {
      const answer = answers.shift() ?? [];
      const c: Record<string, unknown> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) c[m] = () => c;
      c.then = (res: (v: unknown) => unknown) => Promise.resolve(answer).then(res);
      return c;
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.resolve.mockResolvedValue({ repo: { provider: 'github', host: null, owner: 'o', repo: 'r', defaultBranch: 'main', segmentId: 's', projectId: 2 }, token: 't' });
});

describe('sweepOrphanedDraftPullRequests - by how the last run ended', () => {
  it('regression: MAJOR 2 - a CANCELLED/FAILED run\'s draft is closed even though its branch has commits, and never readied', async () => {
    h.outcome.mockResolvedValue('dead');
    h.commits.mockResolvedValue(withCommits);
    const out = await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(out).toEqual({ checked: 1, readied: 0, closed: 1, skipped: 0 });
    expect(h.close).toHaveBeenCalledWith(expect.objectContaining({ number: 7, owner: 'o' }));
    expect(h.retire).toHaveBeenCalledWith(expect.anything(), 1, { rowId: 'row-1', taskId: 3, number: 7 });
    expect(h.ready).not.toHaveBeenCalled();
  });

  it('regression: MAJOR 2 - a SUCCEEDED run\'s draft the finalize never adopted is readied with the final text, and the marker cleared', async () => {
    h.outcome.mockResolvedValue('succeeded');
    h.commits.mockResolvedValue(withCommits);
    const out = await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(out).toEqual({ checked: 1, readied: 1, closed: 0, skipped: 0 });
    expect(h.ready).toHaveBeenCalledWith(expect.objectContaining({ number: 7, text: expect.objectContaining({ title: 'Task #3: Fix it' }) }));
    expect(h.opened).toHaveBeenCalledWith(expect.anything(), 1, 'row-1', true);
    expect(h.close).not.toHaveBeenCalled();
  });

  it('a succeeded run with nothing on its branch has nothing to review: the draft is closed', async () => {
    h.outcome.mockResolvedValue('succeeded');
    h.commits.mockResolvedValue(noCommits);
    expect(await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]))).toMatchObject({ closed: 1, readied: 0 });
  });

  it('keeps the marker when marking ready fails (so a row the reconciler reverts to draft is retried), and reports it', async () => {
    h.outcome.mockResolvedValue('succeeded');
    h.commits.mockResolvedValue(withCommits);
    h.ready.mockResolvedValueOnce({ ok: false, reason: 'graphql' });
    await sweepOrphanedDraftPullRequests({} as never, fakeDb([draft]));
    expect(h.opened).toHaveBeenCalledWith(expect.anything(), 1, 'row-1', false);
    expect(h.report).toHaveBeenCalled();
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
    expect(h.retire).not.toHaveBeenCalled();
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

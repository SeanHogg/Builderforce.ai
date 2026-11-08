/**
 * The real ports of the early draft PR: the atomic record, the recovery of a dead claim, the PR that is not ours,
 * the repository that cannot have a draft, and the once-per-run workflow read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  open: vi.fn(),
  release: vi.fn(async (..._a: unknown[]) => undefined),
  record: vi.fn(async (..._a: unknown[]) => ({ id: 'row-1' })),
  list: vi.fn(),
  read: vi.fn(),
  find: vi.fn(async (..._a: unknown[]) => null),
  report: vi.fn(),
}));
vi.mock('../repos/openTaskPullRequest', () => ({ openClaimedPullRequest: h.open, releaseTaskPrClaim: h.release }));
vi.mock('../repos/recordTaskPullRequest', () => ({ recordTaskPullRequest: h.record }));
vi.mock('../repos/readRepoContents', () => ({ listRepoFiles: h.list, readRepoFile: h.read }));
vi.mock('../repos/platformDraftPullRequest', () => ({ findPlatformDraftPullRequest: h.find, PLATFORM_DRAFT_STATUS: 'draft' }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: h.report, reportedFallback: (fallback: unknown) => () => fallback }));
vi.mock('../../infrastructure/database/tenantScope', () => ({ scopedToTenant: () => ({}) }));

import { draftPrPorts } from './draftPrPorts';

/** The ports never read the db themselves any more: the claim detail comes back from the PR-open step. */
const dbWithClaim = () => ({}) as never;

const repoCtx = {
  provider: 'github', host: null, owner: 'o', repo: 'r', token: 't', branch: 'builderforce/task-3', base: 'main',
  repoId: 'repo-1', segmentId: 'seg', projectId: 2,
} as never;

const ports = () => draftPrPorts({
  db: dbWithClaim(), repoCtx, task: { id: 3, title: 'Fix it' }, agentLabel: 'Coder', tenantId: 1, executionId: 9, record: async () => undefined,
});

/** An open step that took the claim, reporting (through the out-parameter) whether it RETOOK a dead one. */
const opens = (result: unknown, claim: { retook: boolean; at: Date }) => (..._a: unknown[]) => {
  Object.assign(_a[4] as object, claim);
  return Promise.resolve(result);
};

const created = { ok: true, number: 7, url: 'https://x/pull/7' };

beforeEach(() => { vi.clearAllMocks(); });

describe('draftPrPorts.openDraft', () => {
  it('opens a DRAFT with the run title and records the row and the stamp in the one write', async () => {
    h.open.mockResolvedValueOnce(created);
    expect(await ports().openDraft()).toEqual(created);
    expect(h.open.mock.calls[0]![3]).toMatchObject({ draft: true, title: 'Task #3: Fix it', head: 'builderforce/task-3' });
    expect(h.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: 3, number: 7, url: created.url, status: 'draft', repoId: 'repo-1' }));
  });

  it('regression: M1 - a failed record is reported, the claim is NOT released, and the open is not reported as success', async () => {
    h.open.mockResolvedValueOnce(created);
    h.record.mockRejectedValueOnce(new Error('tx failed'));
    const out = await ports().openDraft();
    expect(out).toMatchObject({ ok: false, exists: false, reason: expect.stringContaining('not recorded') });
    expect(h.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'recordDraftPr' }));
    expect(h.release).not.toHaveBeenCalled();
  });

  it('regression: M1 - a stale claim (held, no PR stamped) recovers OUR draft the provider reports back, and completes the record', async () => {
    h.open.mockImplementationOnce(opens({ ...created, existing: true, draft: true }, { retook: true, at: new Date() }));
    const out = await ports().openDraft();
    expect(out).toMatchObject({ ok: true, number: 7 });
    // ...and the row carries the marker (the opening execution) so it is the platform's from here on.
    expect(h.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ number: 7, status: 'draft', platformDraftExecutionId: 9 }));
  });

  it('regression: Minor 2 - a pre-existing PR for the branch that we did not create is not adopted; the claim is released', async () => {
    const p = ports();
    const at = new Date();
    h.open.mockImplementationOnce(opens({ ...created, existing: true, draft: false }, { retook: false, at }));
    expect(await p.openDraft()).toMatchObject({ ok: false, exists: true });
    expect(h.record).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledWith(expect.anything(), 1, 3, at); // owner-scoped: only the claim THIS call wrote
    // ...and the run does not try again on every finish attempt.
    h.list.mockResolvedValue({ ok: true, paths: [] });
    expect(await p.hasPullRequestWorkflow()).toBe(false);
  });

  it('regression: Minor 2 - an existing PR is not ours even when it is a draft, unless a dead claim says the open was ours', async () => {
    h.open.mockResolvedValueOnce({ ...created, existing: true, draft: true });
    expect(await ports().openDraft()).toMatchObject({ ok: false, exists: true });
    expect(h.record).not.toHaveBeenCalled();
  });

  it('regression: Minor 3 - a free-plan draft refusal is memoised: the run stops reading and opening, and never opens a non-draft PR', async () => {
    const p = ports();
    h.list.mockResolvedValue({ ok: true, paths: ['.github/workflows/ci.yml'] });
    h.read.mockResolvedValue({ ok: true, content: 'on: pull_request\n' });
    h.open.mockResolvedValueOnce({ ok: false, code: 'draft_unsupported', reason: 'github 422: Draft pull requests are not supported' });
    expect(await p.hasPullRequestWorkflow()).toBe(true);
    expect(await p.openDraft()).toMatchObject({ ok: false, exists: false });
    expect(await p.hasPullRequestWorkflow()).toBe(false); // the next finish attempt never reaches openDraft
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.open.mock.calls.every((c) => (c[3] as { draft?: boolean }).draft === true)).toBe(true);
  });

  it('a lost claim is "already has a PR", not an error', async () => {
    h.open.mockResolvedValueOnce({ ok: false, claimLost: true });
    expect(await ports().openDraft()).toMatchObject({ ok: false, exists: true });
  });
});

describe('draftPrPorts.hasPullRequestWorkflow', () => {
  it('regression: Minor 5 - the workflows are read once per run, however many finish attempts ask', async () => {
    const p = ports();
    h.list.mockResolvedValue({ ok: true, paths: ['.github/workflows/ci.yml'] });
    h.read.mockResolvedValue({ ok: true, content: 'on:\n  pull_request:\n    branches: [main]\n' });
    expect(await p.hasPullRequestWorkflow()).toBe(true);
    expect(await p.hasPullRequestWorkflow()).toBe(true);
    expect(await p.hasPullRequestWorkflow()).toBe(true);
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('does not memoise a read that failed (the next attempt may succeed)', async () => {
    const p = ports();
    h.list.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, paths: [] });
    expect(await p.hasPullRequestWorkflow()).toBe(false);
    expect(await p.hasPullRequestWorkflow()).toBe(false);
    expect(h.list).toHaveBeenCalledTimes(2);
  });

  it('applies the base-branch filter of the workflow', async () => {
    h.list.mockResolvedValue({ ok: true, paths: ['.github/workflows/ci.yml'] });
    h.read.mockResolvedValue({ ok: true, content: 'on:\n  pull_request:\n    branches: [release]\n' });
    expect(await ports().hasPullRequestWorkflow()).toBe(false); // the run's base is main
  });
});

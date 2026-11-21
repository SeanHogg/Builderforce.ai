import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveRepoLinks = vi.fn();
const closeTicketAutomatically = vi.fn();

vi.mock('../contributors/activityIngest', () => ({ resolveRepoLinks: (...a: unknown[]) => resolveRepoLinks(...a) }));
vi.mock('../manager/reviewGateAuthority', () => ({ closeTicketAutomatically: (...a: unknown[]) => closeTicketAutomatically(...a) }));

import {
  completeDeltaTicketsOnPush,
  foldDeltaRows,
  isExcludedCommit,
  referencedTaskIds,
  type DefaultBranchPushRef,
  type PushedCommit,
} from './completeDeltaOnPush';

type Row = { taskId: number; tenantId: number; projectId: number | null; status: string; files: unknown; recordedAt: Date };

/**
 * db whose select chains resolve in ORDER: the first awaited query is the recorded
 * PR-merge-sha lookup, every later one is the delta candidate read.
 */
function dbWith(rows: Row[], mergeRows: Array<{ id: string }> = []) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'where', 'limit']) chain[m] = vi.fn(() => chain);
  let awaited = 0;
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(awaited++ === 0 ? mergeRows : rows).then(resolve);
  return chain as never;
}

const RECEIVED = new Date('2026-11-20T13:00:00Z');
const RECORDED = new Date('2026-11-20T10:00:00Z');
const row = (taskId: number, files: unknown, over: Partial<Row> = {}): Row => ({
  taskId, tenantId: 1, projectId: 7, status: 'in_review', files, recordedAt: RECORDED, ...over,
});
const commit = (id: string, message: string, files: string[] | null, timestamp: string | null = '2026-11-20T12:00:00Z'): PushedCommit =>
  ({ id, message, files, timestamp });
const push = (commits: PushedCommit[], over: Partial<DefaultBranchPushRef> = {}): DefaultBranchPushRef =>
  ({ repoFullName: 'acme/web', ref: 'refs/heads/main', defaultBranch: 'main', after: 'sha-head', commits, ...over });
const run = (db: never, p: DefaultBranchPushRef) => completeDeltaTicketsOnPush({} as never, db, p, RECEIVED);

beforeEach(() => {
  vi.clearAllMocks();
  resolveRepoLinks.mockResolvedValue([{ tenantId: 1, projectId: 7 }]);
  closeTicketAutomatically.mockResolvedValue({ closed: true });
});

describe('completeDeltaTicketsOnPush', () => {
  it('rule (a): closes a ticket a commit message names, recording the sha', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])]), push([commit('sha-1', 'fix the header (task-42)', null)]));
    expect(out.closed).toEqual([{ taskId: 42, sha: 'sha-1', rule: 'reference' }]);
    expect(closeTicketAutomatically).toHaveBeenCalledWith({}, expect.anything(),
      expect.objectContaining({ tenantId: 1, taskId: 42, source: 'delta_push', heldDetail: expect.stringContaining('sha-1') }));
  });

  it('rule (b): closes a ticket when the pushed commits cover every recorded file', async () => {
    const out = await run(dbWith([row(42, ['./src/a.ts', 'src\\b.ts'])]),
      push([commit('sha-1', 'wip', ['src/a.ts']), commit('sha-2', 'more', ['src/b.ts', 'README.md'])]));
    expect(out.closed).toEqual([{ taskId: 42, sha: 'sha-2', rule: 'files' }]);
  });

  it('rule (b): partial coverage closes nothing', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts', 'src/b.ts'])]), push([commit('sha-1', 'wip', ['src/a.ts'])]));
    expect(out.closed).toEqual([]);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
  });

  it('rule (b): a delta that recorded zero files is never matched by files', async () => {
    const out = await run(dbWith([row(42, []), row(43, null)]), push([commit('sha-1', 'wip', ['src/a.ts'])]));
    expect(out.closed).toEqual([]);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
  });

  it('a commit older than the delta does not count', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])]),
      push([commit('sha-1', 'task-42', ['src/a.ts'], '2026-11-20T09:00:00Z')]));
    expect(out.closed).toEqual([]);
  });

  it('a commit with an unparseable timestamp counts for neither rule', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])]), push([commit('sha-1', 'task-42', ['src/a.ts'], 'not a date')]));
    expect(out.closed).toEqual([]);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
  });

  it('a future commit timestamp is clamped to receipt and cannot reach a delta recorded later', async () => {
    const recordedLate = new Date('2026-11-20T14:00:00Z'); // after receipt (clock skew)
    const out = await run(dbWith([row(42, ['src/a.ts'], { recordedAt: recordedLate })]),
      push([commit('sha-1', 'task-42', ['src/a.ts'], '2027-01-01T00:00:00Z')]));
    expect(out.closed).toEqual([]);
  });

  it('a commit without a file list can match only by reference', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])]), push([commit('sha-1', 'wip', null)]));
    expect(out.closed).toEqual([]);
  });

  it('ignores a push to a branch other than the default', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])]),
      push([commit('sha-1', 'task-42', ['src/a.ts'])], { ref: 'refs/heads/feature/x' }));
    expect(out.reason).toMatch(/not the default branch/);
    expect(resolveRepoLinks).not.toHaveBeenCalled();
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
  });

  it('PR merge: a push whose head is a recorded PR merge sha is left to the merge closer', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])], [{ id: 'pr-row' }]),
      push([commit('sha-1', 'task-42', ['src/a.ts'])]));
    expect(out.reason).toMatch(/merge closer owns it/);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
  });

  it('PR merge: a merge-commit push (Merge pull request #N) is skipped whole, branch commits included', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])]), push([
      commit('sha-1', 'wip', ['src/a.ts']),
      commit('sha-2', 'Merge pull request #12 from acme/feature\n\nfeature', ['src/a.ts']),
    ]));
    expect(out.reason).toMatch(/pull-request merge/);
    expect(resolveRepoLinks).not.toHaveBeenCalled();
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
  });

  it('PR merge: a squash commit (#N) is skipped, so its files close nothing', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])]), push([commit('sha-1', 'Tighten the header (#45)', ['src/a.ts'])]));
    expect(out.closed).toEqual([]);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
  });

  it('a revert commit never ships a delta, even when it names one', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'])]),
      push([commit('sha-1', 'Revert "fix header task-42"', ['src/a.ts'])]));
    expect(out.closed).toEqual([]);
  });

  it('ambiguity: two deltas recording the identical file set close neither by files', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = await run(dbWith([row(42, ['src/a.ts']), row(43, ['src/a.ts'])]), push([commit('sha-1', 'wip', ['src/a.ts'])]));
    expect(out.closed).toEqual([]);
    expect(out.ambiguous).toEqual([{ files: ['src/a.ts'], taskIds: [42, 43] }]);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ambiguity: rule (a) disambiguates — the named ticket closes, its twin stays and is reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = await run(dbWith([row(42, ['src/a.ts']), row(43, ['src/a.ts'])]),
      push([commit('sha-1', 'ships ticket/42', ['src/a.ts'])]));
    expect(out.closed).toEqual([{ taskId: 42, sha: 'sha-1', rule: 'reference' }]);
    expect(out.ambiguous).toEqual([{ files: ['src/a.ts'], taskIds: [43] }]);
    warn.mockRestore();
  });

  it('ignores a ticket that is not in review', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'], { status: 'done' })]), push([commit('sha-1', 'task-42', ['src/a.ts'])]));
    expect(out.closed).toEqual([]);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
  });

  it('ignores a ticket outside the projects linked to the repo', async () => {
    const out = await run(dbWith([row(42, ['src/a.ts'], { projectId: 99 })]), push([commit('sha-1', 'task-42', ['src/a.ts'])]));
    expect(out.closed).toEqual([]);
  });

  it('reports a review-gate hold instead of a close', async () => {
    closeTicketAutomatically.mockResolvedValue({ closed: false });
    const out = await run(dbWith([row(42, ['src/a.ts'])]), push([commit('sha-1', 'wip', ['src/a.ts'])]));
    expect(out.closed).toEqual([]);
    expect(out.heldForReview).toEqual([{ taskId: 42, sha: 'sha-1', rule: 'files' }]);
  });
});

describe('foldDeltaRows', () => {
  it('unions files across a ticket\'s delta rows and opens the window at the EARLIEST row', () => {
    const early = new Date('2026-11-20T08:00:00Z');
    const [cand] = foldDeltaRows(
      [row(42, ['src/a.ts']), row(42, ['src/b.ts'], { recordedAt: early })],
      new Set(['1:7']),
    );
    expect(cand).toEqual({ taskId: 42, tenantId: 1, files: ['src/a.ts', 'src/b.ts'], recordedAt: early });
  });
});

describe('referencedTaskIds', () => {
  it('reads task-N, builderforce/task-N and ticket/N', () => {
    expect([...referencedTaskIds('task-13, builderforce/task-14 and ticket/15-slug')].sort()).toEqual([13, 14, 15]);
  });

  it('does not read a bare #N (an issue or PR number) or lookalikes', () => {
    expect(referencedTaskIds('fixes #12').size).toBe(0);
    expect(referencedTaskIds('subtask-9 and myticket/9').size).toBe(0);
  });
});

describe('isExcludedCommit', () => {
  it('excludes PR merge commits, squash merges (with or without a revert quote) and reverts', () => {
    expect(isExcludedCommit('Merge pull request #45 from acme/feature')).toBe(true);
    expect(isExcludedCommit('Tighten the header (#45)')).toBe(true);
    expect(isExcludedCommit('Revert "Tighten the header (#45)"')).toBe(true);
    expect(isExcludedCommit('Revert "fix task-42"')).toBe(true);
  });

  it('keeps an ordinary commit', () => {
    expect(isExcludedCommit('fix header task-42\n\nsee (#45)')).toBe(false);
  });
});

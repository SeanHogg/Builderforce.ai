import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveRepoLink = vi.fn();
const closeTicketAutomatically = vi.fn();
const ticketIdsOnBranch = vi.fn();

vi.mock('../contributors/activityIngest', () => ({ resolveRepoLink: (...a: unknown[]) => resolveRepoLink(...a) }));
vi.mock('../manager/reviewGateAuthority', () => ({ closeTicketAutomatically: (...a: unknown[]) => closeTicketAutomatically(...a) }));
vi.mock('./deltaBranchMatch', () => ({ ticketIdsOnBranch: (...a: unknown[]) => ticketIdsOnBranch(...a) }));

import { completeDeltaTicketsOnMerge } from './completeDeltaOnMerge';

type RepoRow = { id: string; owner: string; repo: string; defaultBranch: string | null; isDefault: boolean };
const WEB: RepoRow = { id: 'repo-web', owner: 'acme', repo: 'web', defaultBranch: null, isDefault: true };

/**
 * db whose select chains resolve in ORDER: the first awaited query is the project's
 * repositories, every later one is the delta/in_review eligibility check.
 */
function dbWith(eligibleRows: Array<{ id: number }>, repoRows: RepoRow[] = [WEB]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['selectDistinct', 'select', 'from', 'innerJoin', 'where']) chain[m] = vi.fn(() => chain);
  let awaited = 0;
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(awaited++ === 0 ? repoRows : eligibleRows).then(resolve);
  return chain as never;
}

const pr = { repoFullName: 'acme/web', number: null, branchName: 'agent/quick-fix', provider: 'github' };

beforeEach(() => {
  vi.clearAllMocks();
  resolveRepoLink.mockResolvedValue({ tenantId: 1, projectId: 7 });
  closeTicketAutomatically.mockResolvedValue({ closed: true });
});

describe('completeDeltaTicketsOnMerge: recorded working branch', () => {
  it('completes a delta ticket whose recorded branch is the merged head branch, scoped to the merged repo', async () => {
    ticketIdsOnBranch.mockResolvedValue([42]);
    const out = await completeDeltaTicketsOnMerge({} as never, dbWith([{ id: 42 }]), pr);
    expect(ticketIdsOnBranch).toHaveBeenCalledWith(
      expect.anything(), 1, 7, 'agent/quick-fix', null,
      { repoId: 'repo-web', isProjectDefault: true, allDefaultBranches: [] },
    );
    expect(closeTicketAutomatically).toHaveBeenCalledWith({}, expect.anything(), { tenantId: 1, taskId: 42, source: 'delta_merge' });
    expect(out.completed).toEqual([42]);
  });

  it('passes the payload default branch (preferred) so a repo defaulting to dev never matches a ticket recorded on dev', async () => {
    ticketIdsOnBranch.mockResolvedValue([]);
    await completeDeltaTicketsOnMerge({} as never, dbWith([]), { ...pr, branchName: 'dev', defaultBranch: 'dev' });
    expect(ticketIdsOnBranch).toHaveBeenCalledWith(expect.anything(), 1, 7, 'dev', 'dev', expect.anything());
  });

  it('falls back to the stored project_repositories default branch', async () => {
    ticketIdsOnBranch.mockResolvedValue([]);
    const web = { ...WEB, defaultBranch: 'trunk-dev' };
    await completeDeltaTicketsOnMerge({} as never, dbWith([], [web]), { ...pr, branchName: 'trunk-dev' });
    expect(ticketIdsOnBranch).toHaveBeenCalledWith(
      expect.anything(), 1, 7, 'trunk-dev', 'trunk-dev', expect.objectContaining({ allDefaultBranches: ['trunk-dev'] }),
    );
  });

  it('hands the matcher EVERY repo\'s default branch, and scopes to the merged repo (same-name branch in another repo)', async () => {
    ticketIdsOnBranch.mockResolvedValue([]);
    const api: RepoRow = { id: 'repo-api', owner: 'acme', repo: 'api', defaultBranch: 'next', isDefault: false };
    await completeDeltaTicketsOnMerge({} as never, dbWith([], [{ ...WEB, defaultBranch: 'main' }, api]), pr);
    expect(ticketIdsOnBranch).toHaveBeenCalledWith(
      expect.anything(), 1, 7, 'agent/quick-fix', 'main',
      { repoId: 'repo-web', isProjectDefault: true, allDefaultBranches: ['main', 'next'] },
    );
    ticketIdsOnBranch.mockClear();
    await completeDeltaTicketsOnMerge({} as never, dbWith([], [WEB, api]), { ...pr, repoFullName: 'acme/api' });
    expect(ticketIdsOnBranch).toHaveBeenCalledWith(
      expect.anything(), 1, 7, 'agent/quick-fix', 'next',
      expect.objectContaining({ repoId: 'repo-api', isProjectDefault: false }),
    );
  });

  it('does not match by branch at all when the project has no row for the merged repo (fail closed)', async () => {
    ticketIdsOnBranch.mockResolvedValue([42]);
    const out = await completeDeltaTicketsOnMerge({} as never, dbWith([{ id: 42 }], []), pr);
    expect(ticketIdsOnBranch).not.toHaveBeenCalled();
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
    expect(out.completed).toEqual([]);
  });

  it('completes nothing, and says why, when several tickets record the same branch (shared branch)', async () => {
    ticketIdsOnBranch.mockResolvedValue([42, 43]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = await completeDeltaTicketsOnMerge({} as never, dbWith([{ id: 42 }, { id: 43 }]), pr);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
    expect(out.completed).toEqual([]);
    expect(out.reason).toMatch(/2 tickets \(42, 43\)/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recorded by 2 tickets'));
    warn.mockRestore();
  });

  it('does nothing, with a reason, when no ticket records that branch', async () => {
    ticketIdsOnBranch.mockResolvedValue([]);
    const out = await completeDeltaTicketsOnMerge({} as never, dbWith([]), pr);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
    expect(out.completed).toEqual([]);
    expect(out.reason).toMatch(/names no ticket/);
  });

  it('leaves a branch-matched ticket alone when it is not an in-review delta ticket', async () => {
    ticketIdsOnBranch.mockResolvedValue([42]);
    const out = await completeDeltaTicketsOnMerge({} as never, dbWith([]), pr);
    expect(closeTicketAutomatically).not.toHaveBeenCalled();
    expect(out.reason).toMatch(/no delta ticket awaiting review/);
  });
});

/**
 * A DRAFT pull request is never merged or auto-fixed by CI (`isMergeCandidate`): the platform's early draft
 * belongs to a run that is still live, and a human's draft is not ready. Green CI on it must not merge the
 * in-progress branch; red CI on it must not dispatch a second run. The build status is still recorded.
 *
 * The merge path here is REAL: `securityGateForTask` (with its draft exclusion) and `mergeOnGreen` run; only the
 * provider head lookup, the repo resolution and the live-run read are stubbed, so a "no merge" result can only
 * come from the code under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  head: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, sha: 'other-sha' })),
  repo: vi.fn(async (..._a: unknown[]) => null),
  live: vi.fn(async (..._a: unknown[]) => false),
  toolEvent: vi.fn(async (..._a: unknown[]) => undefined),
}));
vi.mock('../validation/validationDispatch', () => ({ triggerFastValidatorReview: async () => null }));
vi.mock('../security/prSecurityGate', async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolvePullRequestHead: h.head }));
vi.mock('../repos/resolveDefaultRepo', () => ({ resolveDefaultRepoForTask: h.repo }));
vi.mock('../runtime/liveExecutionStatus', async (orig) => ({ ...(await orig<Record<string, unknown>>()), taskHasLiveRun: h.live }));
vi.mock('../runtime/cloudToolEvents', () => ({ recordCloudToolEvent: h.toolEvent }));

import { ingestRepoCiEvent, type RepoCiEvent } from './ingestRepoCiEvent';
import { pullRequests, tasks, executions, toolAuditEvents } from '../../infrastructure/database/schema';
import type { Env } from '../../env';

type TableRef = typeof pullRequests | typeof tasks | typeof executions | typeof toolAuditEvents;

function makeFakeDb(rowsByTable: Map<TableRef, unknown[]>) {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    const pass = () => c;
    c.from = pass; c.innerJoin = pass; c.leftJoin = pass; c.where = pass; c.orderBy = pass; c.limit = pass;
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return c;
  };
  return {
    select: () => ({ from: (table: TableRef) => chain(rowsByTable.get(table) ?? []) }),
    insert: () => ({ values: () => Promise.resolve([]) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  } as never;
}

const taskRow = { id: 78, projectId: 3, assignedAgentRef: null, tenantId: 5 };
const prRow = (status: string, id = 'pr78') => ({ id, tenantId: 5, taskId: 78, projectId: 3, repoId: 'repo1', buildStatus: null, number: 7, status });
const rows = (...prs: Array<ReturnType<typeof prRow>>) => new Map<TableRef, unknown[]>([
  [tasks, [taskRow]], [executions, [{ id: 9 }]], [pullRequests, prs], [toolAuditEvents, []],
]);
const green: RepoCiEvent = { eventType: 'workflow_run', branch: 'builderforce/task-78', sha: 'sha1', outcome: 'success', rawState: 'success', targetUrl: null, runId: 99 };
const red: RepoCiEvent = { ...green, outcome: 'failure', rawState: 'failure' };
const mergingEnv = { CLOUD_AUTOMERGE_ENABLED: '1' } as unknown as Env;

beforeEach(() => { vi.clearAllMocks(); h.live.mockResolvedValue(false); h.head.mockResolvedValue({ ok: true, sha: 'other-sha' }); });

describe('ingestRepoCiEvent - a draft PR is not a merge candidate', () => {
  it('regression: green CI on a draft does not merge it - the draft is not counted by the gate, so nothing reaches the repo/merge step', async () => {
    const res = await ingestRepoCiEvent(makeFakeDb(rows(prRow('draft'))), mergingEnv, 'secret', green);
    expect(res).toMatchObject({ processed: true, merged: false, buildStatus: 'success' });
    expect(h.head).not.toHaveBeenCalled();
    expect(h.repo).not.toHaveBeenCalled();
  });

  it('regression: MAJOR 3 - a live run\'s draft AT the green sha plus a newer non-draft row on the task does not merge: only the non-draft is judged, and it is not at that commit', async () => {
    h.head.mockImplementation(async (...a: unknown[]) => ({ ok: true as const, sha: a[3] === 'draft-id' ? 'sha1' : 'newer-sha' }));
    const res = await ingestRepoCiEvent(makeFakeDb(rows(prRow('draft', 'draft-id'), prRow('open', 'newer-id'))), mergingEnv, 'secret', green);
    expect(res.merged).toBe(false);
    expect(h.head.mock.calls.map((c) => c[3])).toEqual(['newer-id']); // the draft was never even resolved
    expect(h.repo).not.toHaveBeenCalled();
  });

  it('regression: Minor 6 - green CI while the task still has a live run does not merge', async () => {
    h.live.mockResolvedValue(true);
    const res = await ingestRepoCiEvent(makeFakeDb(rows(prRow('open'))), mergingEnv, 'secret', green);
    expect(res.merged).toBe(false);
    expect(h.head).not.toHaveBeenCalled();
  });

  it('control: green CI on an open PR at the event sha reaches the repo step (the gate really runs)', async () => {
    h.head.mockResolvedValue({ ok: true, sha: 'sha1' });
    // Past the head lookup the gate needs a real scan store; only the fact that the gate got that far matters here.
    await ingestRepoCiEvent(makeFakeDb(rows(prRow('open'))), mergingEnv, 'secret', green).catch(() => undefined);
    expect(h.head).toHaveBeenCalled();
  });

  it('regression: red CI on a draft records the failure but dispatches no auto-fix run', async () => {
    const res = await ingestRepoCiEvent(makeFakeDb(rows(prRow('draft'))), {} as Env, 'secret', red);
    expect(res.buildStatus).toBe('failure');
    expect(res.autoFix).toBeUndefined();
  });

  it('control: the same red CI on an open PR does dispatch the auto-fix run', async () => {
    const res = await ingestRepoCiEvent(makeFakeDb(rows(prRow('open'))), {} as Env, 'secret', red);
    expect(res.autoFix?.attempt).toBe(1);
  });
});

/**
 * A DRAFT pull request is never auto-fixed by CI (`isMergeCandidate`): the platform's early draft belongs to a
 * run that is still live, and a human's draft is not ready. Red CI on it must not dispatch a second run. The
 * build status is still recorded.
 *
 * And the CI webhook never MERGES anything (PRD 48 §4.3): green CI is recorded on the PR row, and the PR merge
 * sweep — the single merge writer — merges by the project's settings. That holds for every env, including the
 * retired `CLOUD_AUTOMERGE_*` switches, so the merge path's own collaborators (the provider head lookup, the
 * repo resolution) are spied on and must never be reached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  head: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, sha: 'sha1' })),
  repo: vi.fn(async (..._a: unknown[]) => null),
  live: vi.fn(async (..._a: unknown[]) => false),
  toolEvent: vi.fn(async (..._a: unknown[]) => undefined),
}));
vi.mock('../validation/validationDispatch', () => ({ triggerFastValidatorReview: async () => null }));
vi.mock('../security/prSecurityGate', async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolvePullRequestHead: h.head }));
vi.mock('../repos/resolveDefaultRepo', () => ({ resolveDefaultRepoForTask: h.repo, resolveDefaultRepoForProject: async () => null }));
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
/** The retired env switches, set the way that used to merge on green. */
const retiredMergingEnv = { CLOUD_AUTOMERGE_ENABLED: '1', CLOUD_AUTOMERGE_REQUIRE_GREEN: '1' } as unknown as Env;

beforeEach(() => { vi.clearAllMocks(); h.live.mockResolvedValue(false); h.head.mockResolvedValue({ ok: true, sha: 'sha1' }); });

describe('ingestRepoCiEvent - green CI is recorded, never merged by the webhook', () => {
  for (const status of ['draft', 'open']) {
    for (const [label, env] of [['no env', {} as Env], ['the retired merge env', retiredMergingEnv]] as const) {
      it(`green CI on a ${status} PR with ${label} records the build and reaches no merge step`, async () => {
        const res = await ingestRepoCiEvent(makeFakeDb(rows(prRow(status))), env, 'secret', green);
        expect(res).toMatchObject({ processed: true, buildStatus: 'success' });
        expect(h.head).not.toHaveBeenCalled();
        expect(h.repo).not.toHaveBeenCalled();
      });
    }
  }
});

describe('ingestRepoCiEvent - a draft PR is not an auto-fix candidate', () => {
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

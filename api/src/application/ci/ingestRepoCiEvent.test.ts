import { describe, it, expect, vi } from 'vitest';
import { ingestRepoCiEvent, AUTOFIX_DEDUPED_REASON, type RepoCiEvent } from './ingestRepoCiEvent';

// A successful build completes the task, and `recordStatusTransition` reaches the
// Validator via a RUNTIME dynamic import (deliberate — it breaks the taskLifecycle →
// validationDispatch → runtimeRoutes cycle). Vitest transforms that whole graph on
// demand, which costs ~20s and blows the default timeout. The Worker bundles the
// import at build time, so stubbing it here removes a test-only cost, not coverage:
// with no Validator agent the real function returns null anyway, which is what the
// fake db already yields.
vi.mock('../validation/validationDispatch', () => ({
  triggerFastValidatorReview: async () => null,
}));
import { pullRequests, tasks, executions, toolAuditEvents, projects } from '../../infrastructure/database/schema';
import type { Env } from '../../env';

type TableRef = typeof pullRequests | typeof tasks | typeof executions | typeof toolAuditEvents | typeof projects;

/**
 * Minimal chainable Drizzle fake: select().from(table) resolves to the rows queued
 * for that table; insert().values() and update().set().where() resolve (and are
 * recorded). Enough to drive the post-merge correlation + loop-guard branches.
 */
function makeFakeDb(rowsByTable: Map<TableRef, unknown[]>) {
  const inserts: Array<{ table: TableRef; values: Record<string, unknown> }> = [];
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {};
    const pass = () => c;
    c.from = pass; c.innerJoin = pass; c.leftJoin = pass; c.where = pass; c.orderBy = pass; c.limit = pass;
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return c;
  }
  return {
    inserts,
    db: {
      select() {
        return { from: (table: TableRef) => chain(rowsByTable.get(table) ?? []) };
      },
      insert(table: TableRef) {
        return { values: (values: Record<string, unknown>) => { inserts.push({ table, values }); return Promise.resolve([]); } };
      },
      update() {
        return { set: () => ({ where: () => Promise.resolve([]) }) };
      },
    },
  };
}

/** Prior `autofix.dispatch` audit rows — one per already-fixed BUILD (keyed by sha). */
const dispatchRows = (...shas: string[]) => shas.map((sha) => ({ args: JSON.stringify({ sha }) }));

const env = {} as unknown as Env;
const baseEvt: RepoCiEvent = {
  eventType: 'workflow_run', branch: 'main', sha: 'merge-sha-1',
  outcome: 'success', rawState: 'success', targetUrl: 'https://gh/run/99', runId: 99,
};
const prRow = { id: 'pr1', tenantId: 5, taskId: 55, projectId: 3, repoId: 'repo1', buildStatus: null };

describe('ingestRepoCiEvent — post-merge build validation', () => {
  it('ignores a deploy-branch build whose sha matches no merged PR', async () => {
    const { db } = makeFakeDb(new Map([[pullRequests, []]]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', baseEvt);
    expect(res.processed).toBe(false);
    expect(res.reason).toMatch(/no merged PR/);
  });

  it('records a successful post-merge build and dispatches no fix', async () => {
    const { db, inserts } = makeFakeDb(new Map<TableRef, unknown[]>([
      [pullRequests, [prRow]],
      [tasks, [{ assignedAgentRef: null }]],
      [executions, [{ id: 7 }]],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', baseEvt);
    expect(res.processed).toBe(true);
    expect(res.buildStatus).toBe('success');
    expect(res.autoFix).toBeUndefined();
    expect(inserts.some((i) => i.values.toolName === 'build.result')).toBe(true);
  });

  it('stops auto-fixing once the per-task attempt cap is reached', async () => {
    const { db, inserts } = makeFakeDb(new Map<TableRef, unknown[]>([
      [pullRequests, [prRow]],
      [tasks, [{ assignedAgentRef: null }]],
      [executions, [{ id: 7 }]],
      [toolAuditEvents, dispatchRows('other-sha-1', 'other-sha-2')],   // 2 prior auto-fix dispatches == MAX
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', { ...baseEvt, outcome: 'failure', rawState: 'failure' });
    expect(res.processed).toBe(true);
    expect(res.buildStatus).toBe('failure');
    expect(res.autoFix).toBeUndefined();
    expect(inserts.some((i) => i.values.toolName === 'build.needs_human')).toBe(true);
  });

  it('does not dispatch when auto-fix is disabled by env flag', async () => {
    const { db } = makeFakeDb(new Map<TableRef, unknown[]>([
      [pullRequests, [prRow]],
      [tasks, [{ assignedAgentRef: null }]],
      [executions, [{ id: 7 }]],
    ]));
    const res = await ingestRepoCiEvent(db as never, { CLOUD_AUTOFIX_ON_BUILD_FAILURE: '0' } as unknown as Env, 'secret', { ...baseEvt, outcome: 'failure', rawState: 'failure' });
    expect(res.processed).toBe(true);
    expect(res.buildStatus).toBe('failure');
    expect(res.autoFix).toBeUndefined();
  });

  it('still treats a ticket-branch event as the pre-merge path', async () => {
    const { db } = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [{ id: 55, projectId: 3, assignedAgentRef: null, tenantId: 5 }]],
      [executions, [{ id: 7 }]],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', { ...baseEvt, branch: 'builderforce/task-55' });
    expect(res.processed).toBe(true);
    expect(res.taskId).toBe(55);
    expect(res.autoFix).toBeUndefined();
  });
});

describe('ingestRepoCiEvent — pre-merge (PR-branch) build validation', () => {
  const taskRow = { id: 78, projectId: 3, assignedAgentRef: null, tenantId: 5 };
  const openPr = { id: 'pr78', tenantId: 5, taskId: 78, projectId: 3, repoId: 'repo1', buildStatus: null };
  const failEvt: RepoCiEvent = { ...baseEvt, branch: 'builderforce/task-78', outcome: 'failure', rawState: 'failure' };

  it('records the failing PR-branch build and returns an auto-fix intent', async () => {
    const { db, inserts } = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [taskRow]],
      [executions, [{ id: 9 }]],
      [pullRequests, [openPr]],
      [toolAuditEvents, []],   // no prior auto-fix dispatches
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', failEvt);
    expect(res.processed).toBe(true);
    expect(res.taskId).toBe(78);
    expect(res.buildStatus).toBe('failure');
    expect(res.autoFix?.attempt).toBe(1);
    // The pre-merge phase rides the remediation payload so the fix run is framed correctly.
    expect(JSON.parse(res.autoFix!.payload).remediation.phase).toBe('pre_merge');
    expect(inserts.some((i) => i.values.toolName === 'build.result')).toBe(true);
  });

  it('stops auto-fixing the PR-branch build once the per-task cap is reached', async () => {
    const { db, inserts } = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [taskRow]],
      [executions, [{ id: 9 }]],
      [pullRequests, [openPr]],
      [toolAuditEvents, dispatchRows('other-sha-1', 'other-sha-2')],   // == MAX
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', failEvt);
    expect(res.buildStatus).toBe('failure');
    expect(res.autoFix).toBeUndefined();
    expect(inserts.some((i) => i.values.toolName === 'build.needs_human')).toBe(true);
  });

  it('records a non-authoritative check failure (no runId) WITHOUT dispatching a fix', async () => {
    const { db, inserts } = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [taskRow]],
      [executions, [{ id: 9 }]],
      [pullRequests, [openPr]],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', {
      eventType: 'check_suite', branch: 'builderforce/task-78', sha: 'x',
      outcome: 'failure', rawState: 'failure', targetUrl: null, runId: null,
    });
    expect(res.buildStatus).toBe('failure');
    expect(res.autoFix).toBeUndefined();   // not auto-fix eligible — many per-check events
    expect(inserts.some((i) => i.values.toolName === 'build.result')).toBe(true);
  });

  /**
   * Bitbucket repos wire several CI systems to one commit, and EACH posts its own
   * authoritative terminal commit status. Without per-build de-duplication two red
   * keys on one commit would spend both auto-fix attempts on the same build.
   */
  describe('per-build de-duplication across status keys', () => {
    const bbEvt: RepoCiEvent = {
      eventType: 'commit_status', branch: 'builderforce/task-78', sha: 'commit-abc',
      outcome: 'failure', rawState: 'FAILED', targetUrl: 'https://bb/pipelines/results/5',
      runId: null, authoritative: true, statusKey: 'PIPELINE',
    };
    const rows = (audit: unknown[]) => new Map<TableRef, unknown[]>([
      [tasks, [taskRow]],
      [executions, [{ id: 9 }]],
      [pullRequests, [openPr]],
      [toolAuditEvents, audit],
    ]);

    it('spends one attempt for the first key and none for a sibling key on the same commit', async () => {
      const first = makeFakeDb(rows([]));
      const res1 = await ingestRepoCiEvent(first.db as never, env, 'secret', bbEvt);
      expect(res1.autoFix?.attempt).toBe(1);
      expect(res1.autoFix?.sha).toBe('commit-abc');

      // The sibling arrives while the dispatch is still in flight (no audit row yet):
      // the claim written by the first decision is what stops it.
      const second = makeFakeDb(rows([]));
      const res2 = await ingestRepoCiEvent(second.db as never, env, 'secret', { ...bbEvt, statusKey: 'SONAR' });
      expect(res2.buildStatus).toBe('failure');
      expect(res2.autoFix).toBeUndefined();
      expect(res2.reason).toBe(AUTOFIX_DEDUPED_REASON);
    });

    it('de-duplicates off the durable dispatch record once it lands', async () => {
      const { db } = makeFakeDb(rows(dispatchRows('commit-abc')));
      const res = await ingestRepoCiEvent(db as never, env, 'secret', { ...bbEvt, statusKey: 'SONAR' });
      expect(res.autoFix).toBeUndefined();
      expect(res.reason).toBe(AUTOFIX_DEDUPED_REASON);
    });

    it('still spends the second attempt on the NEXT build (a fix commit = a new sha)', async () => {
      const { db } = makeFakeDb(rows(dispatchRows('commit-abc')));
      const res = await ingestRepoCiEvent(db as never, env, 'secret', { ...bbEvt, sha: 'commit-def' });
      expect(res.autoFix?.attempt).toBe(2);
      expect(res.autoFix?.sha).toBe('commit-def');
    });

    it('leaves the exhaustion path intact — two distinct builds still hit the cap', async () => {
      const { db, inserts } = makeFakeDb(rows(dispatchRows('commit-abc', 'commit-def')));
      const res = await ingestRepoCiEvent(db as never, env, 'secret', { ...bbEvt, sha: 'commit-ghi' });
      expect(res.autoFix).toBeUndefined();
      expect(inserts.some((i) => i.values.toolName === 'build.needs_human')).toBe(true);
    });
  });

  it('records a green PR-branch build (clears any prior failure) and dispatches no fix', async () => {
    const { db, inserts } = makeFakeDb(new Map<TableRef, unknown[]>([
      [tasks, [taskRow]],
      [executions, [{ id: 9 }]],
      [pullRequests, [openPr]],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', { ...baseEvt, branch: 'builderforce/task-78' });
    expect(res.processed).toBe(true);
    expect(res.buildStatus).toBe('success');
    expect(res.autoFix).toBeUndefined();
    expect(inserts.some((i) => i.values.toolName === 'build.result')).toBe(true);
  });
});

/**
 * Path 1b — the IDE bridge's own branch. Designer/Mobile PRs are opened by
 * `repoBridge`, not by an agent working a ticket, so they carry a projectId and
 * NO taskId. They used to fall through to the post-merge path, which correlates
 * by merged-PR sha and therefore matched nothing: an IDE-opened PR showed no
 * build status at all.
 */
describe('ingestRepoCiEvent — designer/mobile branch (IDE bridge)', () => {
  const designerEvt: RepoCiEvent = {
    ...baseEvt, branch: 'builderforce/designer-42', sha: 'designer-sha',
  };
  const projectRow = { id: 42, tenantId: 5 };
  const designerPr = { id: 'pr-d1', tenantId: 5, taskId: null, projectId: 42, repoId: 'repo1', buildStatus: null };

  it('records a green build on the project PR', async () => {
    const { db, inserts } = makeFakeDb(new Map<TableRef, unknown[]>([
      [projects, [projectRow]],
      [pullRequests, [designerPr]],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', designerEvt);
    expect(res.processed).toBe(true);
    expect(res.buildStatus).toBe('success');
    const build = inserts.find((i) => i.values.toolName === 'build.result');
    expect(build?.values.sessionKey).toBe('project:42');
  });

  it('records a failing build with a reason', async () => {
    const { db, inserts } = makeFakeDb(new Map<TableRef, unknown[]>([
      [projects, [projectRow]],
      [pullRequests, [designerPr]],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', {
      ...designerEvt, outcome: 'failure', rawState: 'failure',
    });
    expect(res.processed).toBe(true);
    expect(res.buildStatus).toBe('failure');
    expect(String(inserts.find((i) => i.values.toolName === 'build.result')?.values.result)).toMatch(/failed/i);
  });

  // There is no ticket and no assigned agent behind an IDE-opened PR, so there is
  // nothing to hand a failing build to — the feedback belongs on screen instead.
  it('never dispatches an auto-fix run for a designer branch', async () => {
    const { db } = makeFakeDb(new Map<TableRef, unknown[]>([
      [projects, [projectRow]],
      [pullRequests, [designerPr]],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', {
      ...designerEvt, outcome: 'failure', rawState: 'failure',
    });
    expect(res.autoFix).toBeUndefined();
  });

  it('ignores a non-terminal (pending) build', async () => {
    const { db } = makeFakeDb(new Map<TableRef, unknown[]>([
      [projects, [projectRow]],
      [pullRequests, [designerPr]],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', {
      ...designerEvt, outcome: 'pending', rawState: 'in_progress',
    });
    expect(res.processed).toBe(false);
  });

  it('is a no-op when the project has no open PR', async () => {
    const { db } = makeFakeDb(new Map<TableRef, unknown[]>([
      [projects, [projectRow]],
      [pullRequests, []],
    ]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', designerEvt);
    expect(res.processed).toBe(false);
    expect(res.reason).toMatch(/no open PR/);
  });

  it('is a no-op for an unknown project', async () => {
    const { db } = makeFakeDb(new Map<TableRef, unknown[]>([[projects, []]]));
    const res = await ingestRepoCiEvent(db as never, env, 'secret', designerEvt);
    expect(res.processed).toBe(false);
    expect(res.reason).toMatch(/no project/);
  });
});

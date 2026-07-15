import { describe, it, expect, vi } from 'vitest';
import { ingestRepoCiEvent, type RepoCiEvent } from './ingestRepoCiEvent';

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
import { pullRequests, tasks, executions, toolAuditEvents } from '../../infrastructure/database/schema';
import type { Env } from '../../env';

type TableRef = typeof pullRequests | typeof tasks | typeof executions | typeof toolAuditEvents;

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
      [toolAuditEvents, [{ n: 2 }]],   // 2 prior auto-fix dispatches == MAX
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
      [toolAuditEvents, [{ n: 0 }]],   // no prior auto-fix dispatches
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
      [toolAuditEvents, [{ n: 2 }]],   // == MAX
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

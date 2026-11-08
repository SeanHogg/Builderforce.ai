/**
 * The agent-host execution loop on /api/workflows: `POST /claim` (a host takes the
 * oldest pending workflow assigned to it) and `POST /:id/host-result` (it reports
 * task results + the final status). Driven through the real router with a queued
 * Drizzle double — the rules under test are the ownership check, the race guard,
 * and what gets written, not Postgres.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

const mocks = vi.hoisted(() => ({
  hostAuth: vi.fn(),
  bulkUpdate: vi.fn(async () => undefined),
}));

vi.mock('../../infrastructure/auth/agentHostAuth', () => ({ resolveHostAuth: mocks.hostAuth }));
vi.mock('../../infrastructure/database/bulkUpdate', () => ({ bulkUpdateById: mocks.bulkUpdate }));
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any) => c.text('Unauthorized', 401),
}));
vi.mock('../middleware/hostOrTenantAuth', () => ({
  hostOrTenantAuth: () => async (_c: any, next: any) => next(),
  requestAgentHostId: () => null,
}));
vi.mock('../middleware/requirePermission', () => ({ requirePermission: () => async (_c: any, next: any) => next() }));

import { createWorkflowRoutes } from './workflowRoutes';
import { errorHandler } from '../middleware/errorHandler';

const HOST = 5;

/** Flatten a Drizzle SQL object to its literal text and its bound values. */
function sqlParts(node: unknown, text: string[] = [], bound: unknown[] = [], seen = new Set<unknown>()) {
  // A value interpolated into a plain sql`` template sits in queryChunks as a bare
  // primitive (only column-typed values are wrapped in a Param); literal SQL text is a
  // StringChunk whose `value` is a string[].
  if (typeof node === 'string' || typeof node === 'number') { bound.push(node); return { text, bound }; }
  if (node === null || typeof node !== 'object' || seen.has(node)) return { text, bound };
  seen.add(node);
  const n = node as { queryChunks?: unknown[]; value?: unknown; encoder?: unknown };
  if (Array.isArray(n.value)) text.push(...n.value.filter((v): v is string => typeof v === 'string'));
  else if (n.encoder !== undefined && 'value' in n) bound.push(n.value);
  for (const chunk of n.queryChunks ?? []) sqlParts(chunk, text, bound, seen);
  return { text, bound };
}

function appFor(db: ReturnType<typeof fakeDb>) {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/workflows', createWorkflowRoutes(db as unknown as Db));
  return app;
}

const post = (app: Hono, path: string, body?: unknown) =>
  app.request(`/api/workflows${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostAuth.mockResolvedValue({ id: HOST });
});

describe('POST /claim', () => {
  it('rejects an unauthenticated host', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const db = fakeDb();
    const res = await post(appFor(db), '/claim');
    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it('claims the oldest pending workflow, flips it to running and returns its tasks', async () => {
    const pending = { id: 'wf-1', agentHostId: HOST, status: 'pending' };
    const claimed = { ...pending, status: 'running' };
    const tasks = [{ id: 't1', workflowId: 'wf-1' }, { id: 't2', workflowId: 'wf-1' }];
    const db = fakeDb([[pending], [claimed], tasks]);

    const res = await post(appFor(db), '/claim');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workflow: claimed, tasks });
    // Oldest first, one row.
    const select = db.calls[0]!;
    expect(select.chain).toContain('orderBy');
    expect(select.chain).toContain('limit');
    // Ascending by creation time — oldest first, never newest.
    const order = sqlParts(select.orderBy![0]).text.join('').toLowerCase();
    expect(order).toContain('asc');
    expect(order).not.toContain('desc');
    // The flip writes status 'running'.
    const update = db.calls[1]!;
    expect(update.kind).toBe('update');
    expect(update.payload).toMatchObject({ status: 'running' });
  });

  it('answers { workflow: null } when nothing is pending', async () => {
    const db = fakeDb([[]]);
    const res = await post(appFor(db), '/claim');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workflow: null });
    expect(db.calls).toHaveLength(1); // no update attempted
  });

  it('does not return a workflow another claimer won (the guarded update affects 0 rows)', async () => {
    const db = fakeDb([[{ id: 'wf-1', agentHostId: HOST, status: 'pending' }], []]);
    const res = await post(appFor(db), '/claim');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workflow: null });
    // The tasks are never read for a workflow this host did not win.
    expect(db.calls.filter((c) => c.kind === 'select')).toHaveLength(1);
  });
});

describe('POST /:id/host-result', () => {
  it('rejects an unauthenticated host', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const res = await post(appFor(fakeDb()), '/wf-1/host-result', {});
    expect(res.status).toBe(401);
  });

  it('404s for a host that does not own the workflow, writing nothing', async () => {
    const db = fakeDb([[{ id: 'wf-1', agentHostId: HOST + 1 }]]);
    const res = await post(appFor(db), '/wf-1/host-result', { status: 'completed', tasks: [] });
    expect(res.status).toBe(404);
    expect(mocks.bulkUpdate).not.toHaveBeenCalled();
    expect(db.calls.filter((c) => c.kind === 'update')).toHaveLength(0);
  });

  it('404s for an unknown workflow', async () => {
    const db = fakeDb([[]]);
    const res = await post(appFor(db), '/nope/host-result', { status: 'completed' });
    expect(res.status).toBe(404);
  });

  it('updates the reported tasks in one set-based write and sets the workflow status', async () => {
    const db = fakeDb([[{ id: 'wf-1', agentHostId: HOST }], []]);
    const res = await post(appFor(db), '/wf-1/host-result', {
      status: 'completed',
      tasks: [
        { id: 't1', status: 'completed', output: 'done' },
        { id: 't2', status: 'failed', error: 'boom' },
        { id: 't1', status: 'completed', error: null }, // duplicate id merges in report order
      ],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mocks.bulkUpdate).toHaveBeenCalledTimes(1);
    const spec = (mocks.bulkUpdate.mock.calls[0] as unknown as [unknown, { table: string; rows: Array<{ id: string; set: Record<string, unknown> }> }])[1];
    expect(spec.table).toBe('workflow_tasks');
    // The set-based write is fenced to THIS workflow's tasks.
    const scope = sqlParts((spec as unknown as { where: unknown }).where);
    expect(scope.text.join('')).toContain('t.workflow_id');
    expect(scope.bound).toContain('wf-1');
    expect(spec.rows.map((r) => r.id).sort()).toEqual(['t1', 't2']);
    const t1 = spec.rows.find((r) => r.id === 't1')!.set;
    expect(t1).toMatchObject({ status: 'completed', output: 'done', error: null });
    expect(t1.completed_at).toBeInstanceOf(Date);
    expect(spec.rows.find((r) => r.id === 't2')!.set).toMatchObject({ status: 'failed', error: 'boom' });

    const update = db.calls.find((c) => c.kind === 'update')!;
    expect(update.payload).toMatchObject({ status: 'completed' });
    expect((update.payload as { completedAt?: unknown }).completedAt).toBeInstanceOf(Date);
  });

  it('a running task stamps started_at and not completed_at', async () => {
    const db = fakeDb([[{ id: 'wf-1', agentHostId: HOST }], []]);
    await post(appFor(db), '/wf-1/host-result', { tasks: [{ id: 't1', status: 'running' }] });
    const spec = (mocks.bulkUpdate.mock.calls[0] as unknown as [unknown, { rows: Array<{ id: string; set: Record<string, unknown> }> }])[1];
    const set = spec.rows[0]!.set;
    expect(set).toMatchObject({ status: 'running' });
    expect(set.started_at).toBeInstanceOf(Date);
    expect(set).not.toHaveProperty('completed_at');
    // No workflow status reported → no workflow update.
    expect(db.calls.filter((c) => c.kind === 'update')).toHaveLength(0);
  });

  it('a non-terminal status does not stamp completedAt', async () => {
    const db = fakeDb([[{ id: 'wf-1', agentHostId: HOST }], []]);
    await post(appFor(db), '/wf-1/host-result', { status: 'running' });
    const update = db.calls.find((c) => c.kind === 'update')!;
    expect(update.payload).not.toHaveProperty('completedAt');
  });

  it('rejects a malformed body with 400 and writes nothing', async () => {
    const db = fakeDb([[{ id: 'wf-1', agentHostId: HOST }]]);
    const res = await post(appFor(db), '/wf-1/host-result', { status: 'exploded', tasks: [{ id: 1, status: 'completed' }] });
    expect(res.status).toBe(400);
    expect(mocks.bulkUpdate).not.toHaveBeenCalled();
    expect(db.calls.filter((c) => c.kind === 'update')).toHaveLength(0);
  });
});

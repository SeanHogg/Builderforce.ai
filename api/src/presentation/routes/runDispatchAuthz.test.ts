import { describe, expect, it, vi } from 'vitest';

/**
 * Authorization coverage for autonomous-run dispatch + approvals.
 *
 * Two holes are asserted closed here:
 *   • runtimeRoutes had ZERO role gating — any authenticated member (including a
 *     read-only VIEWER) could start / cancel / steer a billable run.
 *   • PATCH /api/approvals/:id had no MANAGER check, so any member could clear an
 *     execution-approval gate and thereby trigger a billable autonomous run.
 *
 * The REAL `requireRole` / `isManager` run here — only `authMiddleware` is faked,
 * so each test can pick the caller's role.
 */

// The role the faked authMiddleware injects; each test sets it before requesting.
let callerRole = 'developer';

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/authMiddleware')>();
  return {
    ...actual,
    authMiddleware: async (c: any, next: any) => {
      c.set('userId', 'user-abc');
      c.set('tenantId', 7);
      c.set('role', callerRole);
      await next();
    },
  };
});

import { createRuntimeRoutes } from './runtimeRoutes';
import { createApprovalRoutes } from './approvalRoutes';
import { errorHandler } from '../middleware/errorHandler';

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Request a router with an empty Bindings env + a no-op executionCtx, the way
 *  the Worker supplies them in production. */
const req = (app: { request: (...a: any[]) => Promise<Response> }, path: string, init?: RequestInit) =>
  app.request(path, init, {}, { waitUntil: () => {}, passThroughOnException: () => {} });

// ---------------------------------------------------------------------------
// runtimeRoutes
// ---------------------------------------------------------------------------

/** Runtime router with the production error handler attached, so a thrown
 *  ForbiddenError maps to 403 exactly as it does behind index.ts's app.onError. */
function runtimeApp() {
  const runtimeService = {
    submit: vi.fn(async () => ({ id: 1, status: 'pending', toPlain: () => ({ id: 1 }) })),
    getExecution: vi.fn(async () => ({ toPlain: () => ({ id: 1, tenantId: 7, status: 'running' }) })),
    cancel: vi.fn(async () => ({ id: 1, status: 'cancelled', toPlain: () => ({ id: 1, status: 'cancelled' }) })),
    listByTenant: vi.fn(async () => []),
    update: vi.fn(async () => ({ id: 1, status: 'running', toPlain: () => ({ id: 1, status: 'running' }) })),
  };
  // Reached only if a gate lets the request through; every gated test asserts on
  // the 403 instead, and the DEVELOPER-allowed cases use routes that stop before
  // touching the db (or short-circuit on an empty task lookup → 404).
  const db = {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: () => Promise.resolve(undefined) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
  };
  const app = createRuntimeRoutes(runtimeService as never, db as never);
  app.onError(errorHandler as never);
  return { app, runtimeService };
}

const RUN_MUTATIONS: Array<[string, RequestInit]> = [
  ['/sessions',               json('POST', {})],
  ['/tasks/submit',           json('POST', { taskId: 1 })],
  ['/tasks/1/cancel',         { method: 'POST' }],
  ['/executions',             json('POST', { taskId: 1 })],
  ['/executions/1/telemetry', json('POST', {})],
  ['/executions/1/cancel',    { method: 'POST' }],
  ['/executions/1/messages',  json('POST', { text: 'go' })],
  ['/executions/1/state',     json('PATCH', { status: 'running' })],
  ['/tasks/1/broadcast',      json('POST', {})],
];

describe('runtimeRoutes — run dispatch is role-gated', () => {
  it.each(RUN_MUTATIONS)('refuses a VIEWER on %s', async (path, init) => {
    callerRole = 'viewer';
    const { app, runtimeService } = runtimeApp();
    const res = await req(app, path, init);
    expect(res.status).toBe(403);
    expect(runtimeService.submit).not.toHaveBeenCalled();
    expect(runtimeService.cancel).not.toHaveBeenCalled();
  });

  it.each(RUN_MUTATIONS)('lets a DEVELOPER through on %s', async (path, init) => {
    callerRole = 'developer';
    const { app } = runtimeApp();
    const res = await req(app, path, init);
    expect(res.status).not.toBe(403);
  });

  it('lets a MANAGER through on POST /executions', async () => {
    callerRole = 'manager';
    const { app } = runtimeApp();
    const res = await req(app, '/executions', json('POST', { taskId: 1 }));
    expect(res.status).not.toBe(403);
  });

  it('keeps reads open to a VIEWER', async () => {
    callerRole = 'viewer';
    const { app } = runtimeApp();
    const res = await req(app, '/executions');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// approvalRoutes
// ---------------------------------------------------------------------------

const PENDING_APPROVAL = {
  id: 'appr-1',
  tenantId: 7,
  kind: 'approval',
  status: 'pending',
  actionType: 'task.execution',
  description: 'Approve execution of task #42',
  metadata: null,
  executionId: null,
  agentHostId: null,
  requestedBy: 'user-abc',
};

function approvalApp() {
  const updated = vi.fn();
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([PENDING_APPROVAL]) }) }),
    update: () => ({ set: (v: unknown) => { updated(v); return { where: () => Promise.resolve(undefined) }; } }),
    insert: () => ({ values: () => Promise.resolve(undefined) }),
  };
  const app = createApprovalRoutes(db as never, {} as never);
  app.onError(errorHandler as never);
  return { app, updated };
}

describe('approvalRoutes — resolving an approval is MANAGER-gated', () => {
  it('refuses a VIEWER outright', async () => {
    callerRole = 'viewer';
    const { app, updated } = approvalApp();
    const res = await req(app, '/appr-1', json('PATCH', { status: 'approved' }));
    expect(res.status).toBe(403);
    expect(updated).not.toHaveBeenCalled();
  });

  it('refuses a DEVELOPER member approving (it would start a billable run)', async () => {
    callerRole = 'developer';
    const { app, updated } = approvalApp();
    const res = await req(app, '/appr-1', json('PATCH', { status: 'approved' }));
    expect(res.status).toBe(403);
    expect(updated).not.toHaveBeenCalled();
  });

  it('refuses a DEVELOPER member rejecting', async () => {
    callerRole = 'developer';
    const { app } = approvalApp();
    const res = await req(app, '/appr-1', json('PATCH', { status: 'rejected' }));
    expect(res.status).toBe(403);
  });

  it('allows a MANAGER to approve', async () => {
    callerRole = 'manager';
    const { app, updated } = approvalApp();
    const res = await req(app, '/appr-1', json('PATCH', { status: 'approved' }));
    expect(res.status).toBe(200);
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });
});

describe('approvalRoutes — creation is authenticated + role-gated', () => {
  it('refuses a VIEWER creating a request', async () => {
    callerRole = 'viewer';
    const { app } = approvalApp();
    const res = await req(app, '/', json('POST', { actionType: 'deploy', description: 'ship it' }));
    expect(res.status).toBe(403);
  });

  it('refuses a client-forged task.execution gate even from a MANAGER', async () => {
    callerRole = 'manager';
    const { app } = approvalApp();
    const res = await req(app, '/', json('POST', { actionType: 'task.execution', description: 'run #42' }));
    expect(res.status).toBe(400);
  });

  it('rejects /escalate when CRON_SECRET is not configured (fails closed)', async () => {
    const { app } = approvalApp();
    const res = await req(app, '/escalate');
    expect(res.status).toBe(401);
  });
});

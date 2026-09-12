/**
 * Workspace-role gates on the kanban writes that had none: audit recompute and
 * sign-off write the ticket's audit ledger, so they take the board's working-team
 * tier (developer) — a viewer or a canvas contributor is refused.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const state = vi.hoisted(() => ({ role: 'viewer' as string }));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/authMiddleware')>();
  return {
    ...actual,
    authMiddleware: async (c: any, next: any) => {
      c.set('tenantId', 5);
      c.set('userId', 'user-1');
      c.set('role', state.role);
      await next();
    },
  };
});

const computeAudit = vi.hoisted(() => vi.fn(async () => ({ taskId: 9, gaps: [] })));
vi.mock('../../application/audit/ticketAuditService', () => ({
  TicketAuditService: function () { return { computeAudit, getAudit: vi.fn() }; },
}));

const { createKanbanRoutes } = await import('./kanbanRoutes');
const { errorHandler } = await import('../middleware/errorHandler');

function app() {
  const a = new Hono();
  a.onError(errorHandler);
  a.route('/', createKanbanRoutes({} as never));
  return a;
}

const post = (body: unknown = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('kanban ledger writes', () => {
  it('refuses a viewer and a contributor on recompute and sign-off', async () => {
    for (const role of ['viewer', 'contributor']) {
      state.role = role;
      expect((await app().request('/tasks/9/audit/recompute', post(), {})).status).toBe(403);
      expect((await app().request('/tasks/9/signoff', post({ roleKey: 'qa-tester' }), {})).status).toBe(403);
    }
    expect(computeAudit).not.toHaveBeenCalled();
  });

  it('lets a developer recompute', async () => {
    state.role = 'developer';
    const res = await app().request('/tasks/9/audit/recompute', post(), {});
    expect(res.status).toBe(200);
    expect(computeAudit).toHaveBeenCalledTimes(1);
  });
});

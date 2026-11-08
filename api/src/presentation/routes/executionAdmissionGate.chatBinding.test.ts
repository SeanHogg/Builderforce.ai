/**
 * The submit routes' shared pre-row gate refuses a `payload.chatId` the submitter cannot
 * open — BEFORE admission, the token gate or the approval gate run — with run-now's words.
 * Both `/executions` and `/tasks/submit` go through `submitRunGates`.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  unbindable: vi.fn(async (..._a: unknown[]) => null as number | null),
  admit: vi.fn(async (..._a: unknown[]) => null),
  token: vi.fn(async (..._a: unknown[]) => null),
  approval: vi.fn(async (..._a: unknown[]) => ({ allowed: true })),
}));
vi.mock('../../application/runtime/runChatBinding', () => ({
  unbindableRunChat: h.unbindable,
  UNBINDABLE_RUN_CHAT_ERROR: 'Originating Brain chat not found',
}));
vi.mock('../../application/runtime/humanDispatchAdmission', () => ({
  admitHumanDispatch: h.admit,
  admissionRefusalResponse: () => ({ body: {}, status: 409 }),
}));
vi.mock('./executionTokenGate', () => ({ executionTokenGate: h.token }));
vi.mock('../../application/runtime/executionApprovalGate', () => ({ evaluateExecutionApprovalGate: h.approval }));

import { submitRunGates } from './executionAdmissionGate';

function app() {
  const a = new Hono();
  a.use('*', async (c, next) => { c.set('tenantId' as never, 5 as never); c.set('userId' as never, 'user-1' as never); await next(); });
  a.post('/submit', async (c) => {
    const payload = await c.req.text();
    const block = await submitRunGates(c as never, {} as never, { task: { id: 9, assignedAgentHostId: null } as never, agentHostId: null, payload });
    return block ?? c.json({ ok: true });
  });
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe('submitRunGates · chat binding', () => {
  it('refuses a payload chat the submitter cannot open, before any other gate', async () => {
    h.unbindable.mockResolvedValueOnce(77);
    const res = await app().request('/submit', { method: 'POST', body: JSON.stringify({ chatId: 77 }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Originating Brain chat not found' });
    expect(h.unbindable).toHaveBeenCalledWith({}, 5, 'user-1', JSON.stringify({ chatId: 77 }));
    expect(h.admit).not.toHaveBeenCalled();
    expect(h.token).not.toHaveBeenCalled();
    expect(h.approval).not.toHaveBeenCalled();
  });

  it('lets a bindable (or absent) chat through to the remaining gates', async () => {
    const res = await app().request('/submit', { method: 'POST', body: JSON.stringify({ chatId: 77 }) });
    expect(res.status).toBe(200);
    expect(h.approval).toHaveBeenCalledTimes(1);
  });
});

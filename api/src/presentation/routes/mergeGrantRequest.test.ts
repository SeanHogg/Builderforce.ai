/**
 * PRD 48 §4.6 — the ONE way a dispatch route accepts a merge grant. Driven through a real Hono
 * app with the request's identity faked, so the refusal and the write are what a route sees.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  record: vi.fn(async (..._a: unknown[]) => undefined),
  dispatchRefusal: vi.fn(async (..._a: unknown[]) => null as unknown),
}));
vi.mock('../../application/runtime/mergeGrants', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), recordMergeGrant: h.record, mergeGrantDispatchRefusal: h.dispatchRefusal,
}));
vi.mock('../../application/activity/activityLog', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveActorFromContext: vi.fn(async () => ({ type: 'user', ref: 'user-1', name: 'Ada' })),
}));

import { grantMergeFromRequest, refuseMergeGrant, refuseMergeGrantDispatch, zMergeGrant } from './mergeGrantRequest';
import { parseBody, z } from './requestBody';
import { errorHandler } from '../middleware/errorHandler';

const Body = z.object({ mergeGrant: zMergeGrant });

function app(identity: { role: string; agentActorRef?: string; machineActor?: unknown; apiKeyId?: string; clientSurface?: string }) {
  const a = new Hono();
  a.onError(errorHandler as never);
  a.post('/dispatch', async (c) => {
    const ctx = c as never as { set(k: string, v: unknown): void };
    ctx.set('tenantId', 7); ctx.set('userId', 'user-1'); ctx.set('role', identity.role);
    if (identity.agentActorRef) ctx.set('agentActorRef', identity.agentActorRef);
    if (identity.machineActor) ctx.set('machineActor', identity.machineActor);
    if (identity.apiKeyId) ctx.set('apiKeyId', identity.apiKeyId);
    if (identity.clientSurface) ctx.set('clientSurface', identity.clientSurface);
    const body = await parseBody(c as never, Body);
    const refused = refuseMergeGrant(c as never, body.mergeGrant);
    if (refused) return refused;
    await grantMergeFromRequest(c as never, {} as never, body.mergeGrant, { executionId: 42, projectId: 3 });
    return c.json({ ok: true }, 201);
  });
  return a;
}

const post = (identity: Parameters<typeof app>[0], body: unknown) =>
  app(identity).request('/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, {});

beforeEach(() => h.record.mockClear());

describe('a dispatch route\'s merge grant', () => {
  it('is accepted from a person with the merge role, and recorded against the started run', async () => {
    const res = await post({ role: 'developer' }, { mergeGrant: { reason: 'security fix for the login bypass' } });
    expect(res.status).toBe(201);
    expect(h.record).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      tenantId: 7, executionId: 42, grantedBy: 'user-1', reason: 'security fix for the login bypass', projectId: 3,
    }));
  });

  it('is refused (403) for a call made on an agent\'s behalf, and nothing is recorded', async () => {
    const res = await post({ role: 'owner', agentActorRef: 'agent-9' }, { mergeGrant: { reason: 'ship it' } });
    expect(res.status).toBe(403);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('is refused (403) for a run principal / machine caller', async () => {
    const res = await post({ role: 'owner', machineActor: { kind: 'agent_host', agentHostId: 2 } }, { mergeGrant: { reason: 'ship it' } });
    expect(res.status).toBe(403);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('is refused (403) for a role below the in-product merge role', async () => {
    const res = await post({ role: 'contributor' }, { mergeGrant: { reason: 'ship it' } });
    expect(res.status).toBe(403);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('needs a reason (400 without one)', async () => {
    const res = await app({ role: 'developer' }).request('/dispatch', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mergeGrant: { reason: '   ' } }),
    }, {});
    expect(res.status).toBe(400);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('a dispatch without a grant records nothing', async () => {
    const res = await post({ role: 'viewer' }, {});
    expect(res.status).toBe(201);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('a failed grant write is REPORTED and answered "failed" — never a 500 on a run that started', async () => {
    h.record.mockRejectedValueOnce(new Error('neon down'));
    const a = new Hono();
    a.post('/x', async (c) => {
      const ctx = c as never as { set(k: string, v: unknown): void };
      ctx.set('tenantId', 7); ctx.set('userId', 'user-1'); ctx.set('role', 'developer');
      const outcome = await grantMergeFromRequest(c as never, {} as never, { reason: 'hotfix' }, { executionId: 42 });
      return c.json({ ok: true, mergeGrant: outcome }, 202);
    });
    const res = await a.request('/x', { method: 'POST' }, {});
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, mergeGrant: 'failed' });
  });
});

describe('a grant comes from a PERSON in the WEB APP only', () => {
  it('is refused (403) for an API-key call, and nothing is recorded', async () => {
    const res = await post({ role: 'owner', apiKeyId: 'key-1' }, { mergeGrant: { reason: 'ship it' } });
    expect(res.status).toBe(403);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('is refused (403) from a device client (VS Code), and nothing is recorded', async () => {
    const res = await post({ role: 'owner', clientSurface: 'vscode' }, { mergeGrant: { reason: 'ship it' } });
    expect(res.status).toBe(403);
    expect(h.record).not.toHaveBeenCalled();
  });
});

describe('refuseMergeGrantDispatch — the dispatch must be a single-repo CLOUD run', () => {
  it('answers 400 with the dispatcher-derived code before anything is dispatched', async () => {
    h.dispatchRefusal.mockResolvedValueOnce({ code: 'merge_grant_not_cloud', error: 'on-prem host' });
    const a = new Hono();
    a.post('/x', async (c) => {
      (c as never as { set(k: string, v: unknown): void }).set('tenantId', 7);
      const refused = await refuseMergeGrantDispatch(c as never, {} as never, { reason: 'hotfix' }, { taskId: 9 });
      return refused ?? c.json({ ok: true });
    });
    const res = await a.request('/x', { method: 'POST' }, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'on-prem host', code: 'merge_grant_not_cloud' });
    expect(h.dispatchRefusal).toHaveBeenCalledWith(expect.anything(), expect.anything(), { tenantId: 7, taskId: 9 });
  });

  it('asks nothing when the request carries no grant', async () => {
    h.dispatchRefusal.mockClear();
    const a = new Hono();
    a.post('/x', async (c) => (await refuseMergeGrantDispatch(c as never, {} as never, undefined, { taskId: 9 })) ?? c.json({ ok: true }));
    expect((await a.request('/x', { method: 'POST' }, {})).status).toBe(200);
    expect(h.dispatchRefusal).not.toHaveBeenCalled();
  });
});

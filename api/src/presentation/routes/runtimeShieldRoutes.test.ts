/**
 * POST /api/security/shield-incidents — body validation against the runtime's SecurityEvent
 * contract, tenant/segment from the session, and the outcome → status mapping. The use case is
 * stubbed; its floor/dedupe behaviour is covered in findingIncidentKinds.test.ts.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const record = vi.hoisted(() => vi.fn());
vi.mock('../../application/security/runtimeShieldIncidents', () => ({ recordRuntimeShieldEvent: record }));
vi.mock('../../application/activity/activityLog', () => ({
  resolveActorFromContext: async () => ({ type: 'human', ref: 'u1', name: 'Dev' }),
}));

import { createRuntimeShieldRoutes } from './runtimeShieldRoutes';
import { errorHandler } from '../middleware/errorHandler';
import type { HonoEnv } from '../../env';

const valid = {
  category: 'ingress', ruleId: 'crs-942100', severity: 'high', reasonCode: 'ingress.body_too_large', action: 'reject',
  applicationId: 'app-1', serviceId: 'web', projectId: 42, evidence: { bodyBytes: 9_000_000 },
  occurredAt: '2026-11-18T10:00:00.000Z',
};

function harness() {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('tenantId' as never, 7 as never);
    c.set('segmentId' as never, 'seg' as never);
    await next();
  });
  app.route('/', createRuntimeShieldRoutes({} as never));
  app.onError(errorHandler as never);
  return (body: unknown) => app.request('/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, {} as never, { waitUntil: () => {}, passThroughOnException: () => {} } as never);
}

describe('POST /shield-incidents', () => {
  beforeEach(() => record.mockReset());

  it('records a valid event with the session tenant and segment, answering 201 when an incident opens', async () => {
    record.mockResolvedValue({ outcome: 'opened', incidentId: 'inc-1' });
    const res = await harness()(valid);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ outcome: 'opened', incidentId: 'inc-1' });
    const [, , , ctx, event] = record.mock.calls[0]!;
    expect(ctx).toEqual({ tenantId: 7, segmentId: 'seg' });
    expect(event).toMatchObject({ projectId: 42, ruleId: 'crs-942100', action: 'reject' });
  });

  it.each([
    [{ outcome: 'deduplicated' }, 200],
    [{ outcome: 'ignored' }, 202],
    [{ outcome: 'unknown_project' }, 404],
  ])('maps %j to %i', async (outcome, status) => {
    record.mockResolvedValue(outcome);
    expect((await harness()(valid)).status).toBe(status);
  });

  it.each([
    ['an unknown reason code', { reasonCode: 'port.anything' }],
    ['an unknown category', { category: 'kernel' }],
    ['an unknown action', { action: 'kill' }],
    ['a ruleId that would split the source ref', { ruleId: 'a:b' }],
    ['a non-integer projectId', { projectId: '42' }],
    ['a credential key in evidence', { evidence: { headers: { cookie: 'sid=1' } } }],
    ['a password key in evidence', { evidence: { password: '***' } }],
    ['oversized evidence', { evidence: { blob: 'x'.repeat(5000) } }],
    ['a bad timestamp', { occurredAt: 'yesterday' }],
    ['a client-chosen tenant', { tenantId: 99 }],
    ['a client-chosen sourceRef', { sourceRef: 'shield:1:x:y' }],
  ])('refuses %s with 400 and records nothing', async (_label, patch) => {
    const res = await harness()({ ...valid, ...patch });
    expect(res.status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });
});

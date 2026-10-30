/**
 * POST /v1/run-outcome refuses a client run id inside the cloud's own namespace (`cloud:<executionId>`): that key is the cloud scorer's
 * (`cloudRunId`), so a client that reported under it could shadow - or pre-empt - a cloud run's learning signal.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  recordClientRunOutcome: vi.fn(async () => undefined),
  requireTenantAccess: vi.fn(async () => ({ tenantId: 7 })),
}));

vi.mock('../../../application/runtime/recordClientRunOutcome', () => ({ recordClientRunOutcome: mocks.recordClientRunOutcome }));
vi.mock('../../../application/shared/dbHandle', () => ({ requestDb: () => ({}) }));
vi.mock('./access', () => ({
  requireTenantAccess: mocks.requireTenantAccess,
  respondToAccessError: (c: { json: (b: unknown, s: number) => Response }, err: Error) => c.json({ error: err.message }, 401),
}));

const { mountLearnedRoutingRoutes } = await import('./learnedRoutingRoutes');

async function post(body: unknown) {
  const router = new Hono();
  mountLearnedRoutingRoutes(router as never);
  return router.request('http://test.local/v1/run-outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {});
}

const report = (clientRunId: string) => ({ clientRunId, model: 'minimaxai/minimax-m3', source: 'canvas', terminalStatus: 'completed', steps: 4 });

beforeEach(() => mocks.recordClientRunOutcome.mockClear());

describe('POST /v1/run-outcome - the reserved cloud run-id namespace', () => {
  it.each(['cloud:9', '  cloud:anything', 'cloud:'])('answers 400 for client run id %j and records nothing', async (clientRunId) => {
    const res = await post(report(clientRunId));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("'cloud:'");
    expect(mocks.recordClientRunOutcome).not.toHaveBeenCalled();
  });

  it('a client run id outside the namespace is accepted', async () => {
    const res = await post(report('canvas:run-1'));
    expect(res.status).toBe(200);
    expect(mocks.recordClientRunOutcome).toHaveBeenCalledTimes(1);
  });
});

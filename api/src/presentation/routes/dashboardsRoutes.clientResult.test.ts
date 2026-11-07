/**
 * PRD 42 Part D on `POST /query`: a client-picked intent key is used only when it is one of
 * the whitelisted keys the refiner is offered (else the gateway refiner runs); an invalid
 * clientResult is a 400; absent leaves the gateway refiner as the only refiner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  composeAnswer: vi.fn(),
  gatewayRefiner: vi.fn(async () => 'topic.health'),
  recordClientResultUsage: vi.fn(async () => {}),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', 2); c.set('userId', 'u1'); c.set('role', 'manager'); await next(); },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../../application/dashboards/answerComposer', () => ({ composeAnswer: mocks.composeAnswer }));
vi.mock('../../application/dashboards/gatewayIntentRefiner', () => ({ gatewayIntentRefiner: () => mocks.gatewayRefiner }));
vi.mock('../../application/tenant/tenantPlanSnapshot', () => ({ resolveTenantPlan: async () => ({ effectivePlan: 'pro', premiumOverride: false }) }));
vi.mock('../../application/dashboards/savedDashboards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/dashboards/savedDashboards')>()),
  recordDashboardQuery: vi.fn(async () => {}),
}));
vi.mock('../../application/llm/clientResultUsage', () => ({ recordClientResultUsage: mocks.recordClientResultUsage }));

import { Hono } from 'hono';
import { createDashboardsRoutes } from './dashboardsRoutes';
import type { Db } from '../../infrastructure/database/connection';
import type { IntentRefiner } from '../../application/dashboards/nlQuery';

const provenance = { engine: 'browser', model: 'gemini-nano' };
const KEYS = ['tickets.open', 'topic.health'];

const app = () => {
  const root = new Hono();
  root.route('/api/dashboards', createDashboardsRoutes({} as Db));
  return root;
};
const query = (body: unknown) => app().request('/api/dashboards/query', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}, {});
/** The refiner `composeAnswer` was handed (4th argument's `refiner`). */
const refinerOf = (): IntentRefiner | undefined => {
  const call = mocks.composeAnswer.mock.calls[0] as unknown[];
  return (call[3] as { refiner?: IntentRefiner }).refiner;
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockClear();
  mocks.composeAnswer.mockResolvedValue({ metrics: [{ matchedMetric: 'tickets.open', label: 'Open', value: 1, unit: '', explanation: 'e' }], topic: null, narrative: 'n' });
});

describe('POST /query clientResult', () => {
  it('uses an allowed client key without calling the gateway refiner, and records usage', async () => {
    expect((await query({ question: 'how many open?', clientResult: { json: 'tickets.open', provenance } })).status).toBe(200);
    expect(await refinerOf()!('how many open?', KEYS)).toBe('tickets.open');
    expect(mocks.gatewayRefiner).not.toHaveBeenCalled();
    expect(mocks.recordClientResultUsage).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ tenantId: 2, provenance, useCase: 'dashboard_intent' }));
  });

  it('ignores a key outside the whitelist and runs the gateway refiner', async () => {
    await query({ question: 'q', clientResult: { json: 'drop.table', provenance } });
    expect(await refinerOf()!('q', KEYS)).toBe('topic.health');
    expect(mocks.gatewayRefiner).toHaveBeenCalledTimes(1);
    expect(mocks.recordClientResultUsage).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_client_result for a malformed one and never composes', async () => {
    const res = await query({ question: 'q', clientResult: { json: 42, provenance } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_client_result', reason: 'json_invalid' });
    expect(mocks.composeAnswer).not.toHaveBeenCalled();
  });

  it('is unchanged without a clientResult: the gateway refiner is the refiner', async () => {
    await query({ question: 'q' });
    expect(refinerOf()).toBe(mocks.gatewayRefiner);
  });

  it('refine:false opts out of any refiner, client key included', async () => {
    await query({ question: 'q', refine: false, clientResult: { json: 'tickets.open', provenance } });
    expect(refinerOf()).toBeUndefined();
  });
});

/**
 * `/api/realizations` person-graded routes: the early call is a MANAGER's act
 * (a developer is refused before anything is read), and parking a proof still
 * records its failed grade and bumps the journey signal. Auth is a
 * header-driven stand-in; `requireRole` is the real middleware.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';

const mocks = vi.hoisted(() => ({
  getRealization: vi.fn(),
  abandonRealization: vi.fn(),
  toRealizationView: vi.fn((row: unknown) => row),
  syncRealizationVerdict: vi.fn(),
  evaluateProofMeasure: vi.fn(),
  journeySignal: vi.fn(),
  bumpJourneySignal: vi.fn(),
  recordProofOutcome: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', 7);
    c.set('userId', 'u1');
    c.set('role', (c.req.header('x-role') ?? 'developer') as never);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/realization/realizationStore', () => ({
  getRealization: mocks.getRealization,
  abandonRealization: mocks.abandonRealization,
  toRealizationView: mocks.toRealizationView,
}));
vi.mock('../../application/realization/realizationVerdict', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../application/realization/realizationVerdict')>();
  return { ...real, syncRealizationVerdict: mocks.syncRealizationVerdict };
});
vi.mock('../../application/realization/proofMeasure', () => ({ evaluateProofMeasure: mocks.evaluateProofMeasure }));
vi.mock('../../application/realization/journeySignal', () => ({
  journeySignal: mocks.journeySignal,
  bumpJourneySignal: mocks.bumpJourneySignal,
}));
vi.mock('../../application/realization/proofOutcomes', () => ({ recordProofOutcome: mocks.recordProofOutcome }));

import { errorHandler } from '../middleware/errorHandler';
import { createRealizationMeasureRoutes } from './realizationMeasureRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;
const db = {} as never;

function call(path: string, init: RequestInit & { role?: string } = {}) {
  const router = createRealizationMeasureRoutes(db);
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.role) headers.set('x-role', init.role);
  if (init.body) headers.set('content-type', 'application/json');
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

const ROW = { id: 'r1', projectId: 3, sessionId: 's1', targetKey: 'smoke-test', verdict: null, measure: { windowDays: 14 } };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.toRealizationView.mockImplementation((row: unknown) => row);
});

describe('POST /:id/call-early', () => {
  const callEarly = (role: string) => call('/r1/call-early', {
    method: 'POST', role, body: JSON.stringify({ reason: 'The channel is exhausted.' }),
  });

  it('refuses a non-manager with 403 before reading or grading anything', async () => {
    const res = await callEarly('developer');
    expect(res.status).toBe(403);
    expect(mocks.getRealization).not.toHaveBeenCalled();
    expect(mocks.syncRealizationVerdict).not.toHaveBeenCalled();
  });

  it('lets a manager grade a measured proof now, with the cleaned reason', async () => {
    mocks.getRealization.mockResolvedValue(ROW);
    mocks.syncRealizationVerdict.mockResolvedValue({ ...ROW, verdict: 'missed' });
    const res = await callEarly('manager');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ realization: { ...ROW, verdict: 'missed' } });
    expect(mocks.syncRealizationVerdict).toHaveBeenCalledWith({}, db, 7, ROW, { earlyCallReason: 'The channel is exhausted.' });
  });

  it('409s a proof graded by its console', async () => {
    mocks.getRealization.mockResolvedValue({ ...ROW, measure: null });
    expect((await callEarly('owner')).status).toBe(409);
    expect(mocks.syncRealizationVerdict).not.toHaveBeenCalled();
  });
});

describe('PATCH /:id/verdict', () => {
  it('parks the proof, records the failed grade and bumps the journey signal', async () => {
    mocks.abandonRealization.mockResolvedValue({ ...ROW, verdict: 'abandoned' });
    const res = await call('/r1/verdict', { method: 'PATCH', body: JSON.stringify({ verdict: 'abandoned', note: 'No traffic' }) });
    expect(res.status).toBe(200);
    expect(mocks.abandonRealization).toHaveBeenCalledWith(db, 7, 'r1', 'No traffic');
    expect(mocks.recordProofOutcome).toHaveBeenCalledWith(db, expect.objectContaining({
      tenantId: 7, userId: 'u1', correlationId: 'grade:r1', action: 'proof.grade', phase: 'failed', metadata: { verdict: 'abandoned' },
    }));
    expect(mocks.bumpJourneySignal).toHaveBeenCalledWith({}, 7);
  });

  it('refuses any verdict but "abandoned"', async () => {
    const res = await call('/r1/verdict', { method: 'PATCH', body: JSON.stringify({ verdict: 'met' }) });
    expect(res.status).toBe(400);
    expect(mocks.abandonRealization).not.toHaveBeenCalled();
  });
});

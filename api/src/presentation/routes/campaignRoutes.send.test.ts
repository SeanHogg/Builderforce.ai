/**
 * `POST /campaigns/:id/send` — the inline first batch runs AFTER `startCampaign` has made the
 * campaign live, so a throw from it must not answer 500 for a send that is happening: it is
 * reported, the sweep is signalled so the campaign carries on, and the started campaign comes back.
 * The engine is replaced; the route's own handling is what is under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { fakeDb } from '../../../test/fakeDb';

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', 7);
    c.set('userId', 'u1');
    c.set('role', 'manager' as never);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/marketing/campaignEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/marketing/campaignEngine')>()),
  startCampaign: vi.fn(),
  runCampaignBatch: vi.fn(),
}));
vi.mock('../../application/runtime/cronWorkSignal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/runtime/cronWorkSignal')>()),
  signalPendingWork: vi.fn(async () => undefined),
}));
vi.mock('../../application/observability/caughtErrorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/observability/caughtErrorReporter')>()),
  reportCaughtError: vi.fn(),
}));

import { errorHandler } from '../middleware/errorHandler';
import { runCampaignBatch, startCampaign } from '../../application/marketing/campaignEngine';
import { signalPendingWork } from '../../application/runtime/cronWorkSignal';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { createGrowthRoutes } from './campaignRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;
const campaign = { id: 1, status: 'sending', name: 'Launch' };

const post = () => {
  const router = createGrowthRoutes(fakeDb() as never);
  router.onError(errorHandler as never);
  return router.request('/campaigns/1/send', { method: 'POST' }, {} as never, ctx);
};

beforeEach(() => {
  vi.mocked(startCampaign).mockReset().mockResolvedValue({ ok: true, campaign, queued: 40, suppressed: 2 } as never);
  vi.mocked(runCampaignBatch).mockReset();
  vi.mocked(signalPendingWork).mockClear();
  vi.mocked(reportCaughtError).mockClear();
});

describe('POST /campaigns/:id/send', () => {
  it('returns the started campaign and the batch when the first batch runs', async () => {
    vi.mocked(runCampaignBatch).mockResolvedValue({ sent: 25, failed: 0, remaining: 15, status: 'sending' });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ campaign, queued: 40, suppressed: 2, batch: { sent: 25, remaining: 15 } });
    expect(reportCaughtError).not.toHaveBeenCalled();
    expect(signalPendingWork).not.toHaveBeenCalled();
  });

  it('a first batch that THROWS is reported and signalled, and the live campaign is still returned (not a 500)', async () => {
    const failure = new Error('read failed');
    vi.mocked(runCampaignBatch).mockRejectedValue(failure);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      campaign, queued: 40, suppressed: 2, batch: { sent: 0, failed: 0, remaining: 40, status: 'sending' },
    });
    expect(reportCaughtError).toHaveBeenCalledWith(failure, expect.objectContaining({ operation: 'sendFirstBatch' }));
    expect(signalPendingWork).toHaveBeenCalledTimes(1);
  });

  it('a campaign that could not be started is still refused, and runs no batch', async () => {
    vi.mocked(startCampaign).mockResolvedValue({ ok: false, status: 409, error: 'This campaign is already sending.' } as never);
    const res = await post();
    expect(res.status).toBe(409);
    expect(runCampaignBatch).not.toHaveBeenCalled();
  });
});

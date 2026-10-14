/**
 * `/api/admin/replay-ops/summary` — superadmin only, aggregates only (D17).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), superadmin: true }));

vi.mock('../middleware/superAdminMiddleware', () => {
  const gate: MiddlewareHandler<HonoEnv> = async (c, next) => {
    if (!mocks.superadmin) throw new ForbiddenError('Superadmin access required');
    c.set('userId', 'sa-1');
    c.set('db', {} as never);
    await next();
  };
  return { superAdminMiddleware: gate };
});
vi.mock('../../application/replay/ReplayOpsService', () => ({
  ReplayOpsService: vi.fn(function ReplayOpsService() { return { summary: mocks.summary }; }),
}));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayOpsRoutes } from './replayOpsRoutes';

const SUMMARY = { sites: 3, tenants: 2, sessions7d: 900, keptRecordings7d: 40, bytes7d: 1_000_000, packRevenueCents30d: 4_000 };

function call(path: string) {
  const router = createReplayOpsRoutes();
  router.onError(errorHandler as never);
  return router.request(path, {}, {} as never, { waitUntil: () => {}, passThroughOnException: () => {} } as never);
}

beforeEach(() => {
  mocks.superadmin = true;
  mocks.summary.mockReset();
});

describe('GET /summary', () => {
  it('answers the aggregates to a superadmin', async () => {
    mocks.summary.mockResolvedValue(SUMMARY);
    const res = await call('/summary');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUMMARY);
  });

  it('refuses anyone else before reading', async () => {
    mocks.superadmin = false;
    const res = await call('/summary');
    expect(res.status).toBe(403);
    expect(mocks.summary).not.toHaveBeenCalled();
  });

  it('serves nothing but the summary', async () => {
    const res = await call('/recordings');
    expect(res.status).toBe(404);
  });
});

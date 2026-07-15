import { describe, expect, it, vi } from 'vitest';

const deliveryCollectors = vi.hoisted(() => ({
  dora: vi.fn(async (_db: unknown, _tenantId: number, days: number) => ({
    windowDays: days, deploymentFrequencyPerDay: 0, totalDeployments: 0,
    leadTimeHours: 0, changeFailureRatePct: 0, mttrHours: 0, series: [],
  })),
  bottlenecks: vi.fn(async (_db: unknown, _tenantId: number, days: number) => ({
    windowDays: days, sampleSize: 0, byStage: [], slowestStage: null,
    rework: { reworkRate: 0, reworkedTasks: 0, totalReopens: 0, totalRedos: 0 },
    agingWip: { thresholdHours: 72, stuckCount: 0, oldest: [] },
  })),
  lifecycle: vi.fn(async (_db: unknown, _tenantId: number, days: number) => ({
    windowDays: days, sampleSize: 0, totalAvgHours: 0, byPhase: [], trend: [],
  })),
}));

vi.mock('../../application/metrics/workforceMetrics', () => ({ computeDora: deliveryCollectors.dora }));
vi.mock('../../application/insights/bottleneckInsights', () => ({ computeBottleneckInsights: deliveryCollectors.bottlenecks }));
vi.mock('../../application/insights/lifecycleInsights', () => ({ computeLifecycleInsights: deliveryCollectors.lifecycle }));

const TENANT = 88;
const SEGMENT = 'seg-default';
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', SEGMENT);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

// The premium lenses sit behind requirePlanFeature('advancedInsights'), which resolves
// the tenant's plan from the real database. These tests cover the lens reads, not the
// paywall, and pass a fake db rather than an env — so stub the gate to "entitled".
vi.mock('../middleware/insightPlanGate', () => ({
  requirePlanFeature: () => async (_c: any, next: any) => next(),
}));

import { createInsightsRoutes } from './insightsRoutes';

/** Chainable fake: every builder method returns the chain; awaiting (or
 *  .returning()) resolves to the configured rows. Supports the multi-query
 *  read-models (joins/groupBy) AND the tracker CRUD in one shape. */
function makeDb(opts: { rows?: unknown[]; insertReturn?: unknown[] } = {}) {
  const captured: { insertValues?: any } = {};
  const make = (rows: unknown[]): any => {
    const b: any = {
      from: () => b, where: () => b, innerJoin: () => b, leftJoin: () => b,
      groupBy: () => b, orderBy: () => b, limit: () => b, set: () => b,
      returning: () => Promise.resolve(rows),
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return b;
  };
  const db = {
    select: () => make(opts.rows ?? []),
    insert: () => ({ values: (v: any) => { captured.insertValues = v; return make(opts.insertReturn ?? []); } }),
    update: () => make(opts.insertReturn ?? []),
    delete: () => make(opts.insertReturn ?? []),
  };
  return { db: db as any, captured };
}

const post = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('insightsRoutes — lens reads', () => {
  it('GET /engineering returns an effectiveness rollup (empty-safe)', async () => {
    const { db } = makeDb();
    const res = await createInsightsRoutes(db).request('/engineering');
    expect(res.status).toBe(200);
    expect((await res.json() as any).totals.runs).toBe(0);
  });

  it('GET /dora returns the four-keys rollup', async () => {
    const { db } = makeDb();
    const res = await createInsightsRoutes(db).request('/dora?days=30');
    expect(res.status).toBe(200);
    expect((await res.json() as any).windowDays).toBe(30);
  });

  it('threads projectId through every delivery rollup collector', async () => {
    const { db } = makeDb();
    const router = createInsightsRoutes(db);
    await router.request('/dora?days=14&projectId=321');
    await router.request('/bottlenecks?days=14&projectId=321');
    await router.request('/delivery/lifecycle?days=14&projectId=321');

    expect(deliveryCollectors.dora).toHaveBeenLastCalledWith(db, TENANT, 14, 321);
    expect(deliveryCollectors.bottlenecks).toHaveBeenLastCalledWith(db, TENANT, 14, 321);
    expect(deliveryCollectors.lifecycle).toHaveBeenLastCalledWith(db, TENANT, 14, 321);
  });

  it('GET /finance returns spend + budgets for the period', async () => {
    const { db } = makeDb();
    const res = await createInsightsRoutes(db).request('/finance?period=2026-06');
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.periodMonth).toBe('2026-06');
    expect(j.totals.spendUsd).toBe(0);
  });

  it('GET /compliance returns the audit summary', async () => {
    const { db } = makeDb();
    const res = await createInsightsRoutes(db).request('/compliance');
    expect(res.status).toBe(200);
    expect((await res.json() as any).totalEvents).toBe(0);
  });

  it('GET /compliance/export?format=csv returns a CSV attachment', async () => {
    const { db } = makeDb();
    const res = await createInsightsRoutes(db).request('/compliance/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });
});

describe('insightsRoutes — budget tracker', () => {
  it('rejects a budget with no periodMonth', async () => {
    const { db } = makeDb();
    const res = await createInsightsRoutes(db).request('/budgets', post({ scopeKind: 'tenant', limitUsd: 500 }));
    expect(res.status).toBe(400);
  });

  it('creates a budget, tenant+segment stamped, whitelist enforced', async () => {
    const { db, captured } = makeDb({ insertReturn: [{ id: 'b1' }] });
    const res = await createInsightsRoutes(db).request('/budgets', post({ periodMonth: '2026-06', scopeKind: 'project', projectId: 7, limitUsd: 500, evil: 'x' }));
    expect(res.status).toBe(201);
    expect(captured.insertValues.tenantId).toBe(TENANT);
    expect(captured.insertValues.segmentId).toBe(SEGMENT);
    expect(captured.insertValues.periodMonth).toBe('2026-06');
    expect(captured.insertValues.limitUsd).toBe(500);
    expect('evil' in captured.insertValues).toBe(false);
  });
});

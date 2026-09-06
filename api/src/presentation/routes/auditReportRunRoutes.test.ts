/**
 * The export handler is the ONE logging moment for audit_report_runs, and the
 * runs list is what makes the log visible. So: an export (csv or json) records a
 * run attributed to the request's user and still returns the download; the runs
 * route returns the port's list bounded by `limit`; and the cached
 * `GET /audit-report` in finopsRoutes never records anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 12;
const SEGMENT = 'seg-1';
const USER = 'user-abc';
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', SEGMENT);
    c.set('userId', USER);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

const report = {
  generatedAt: '2026-09-06T10:00:00.000Z', period: '2026-08', windowDays: 30,
  finance: { spendUsd: 10, forecastUsd: 12, paidOverflowUsd: 0, costPerMergedPrUsd: null },
  allocation: { hours: 1, capexUsd: 5, opexUsd: 5, capitalizablePct: 50 },
  rdTaxCredit: { qualifiedHours: 1, blendedRate: 1, qualifiedLaborUsd: 1, qualifiedAiSpendUsd: 1, qualifiedBaseUsd: 2 },
  socControls: { total: 1, implemented: 1, partial: 0, gap: 0, coveragePct: 100 },
  compliance: { windowDays: 30, totalEvents: 3, sensitiveEvents: 0, distinctExecutions: 1, distinctAgents: 1 },
};
vi.mock('../../application/finops/auditReport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/finops/auditReport')>()),
  assembleAuditReport: vi.fn(async () => report),
}));

const runs = vi.hoisted(() => ({ recordAuditReportRun: vi.fn(), listAuditReportRuns: vi.fn() }));
vi.mock('../../application/finops/auditReportRuns', () => runs);

import { createFinopsRoutes } from './finopsRoutes';

const app = () => createFinopsRoutes({} as any);

beforeEach(() => {
  runs.recordAuditReportRun.mockReset().mockResolvedValue({ id: 1 });
  runs.listAuditReportRuns.mockReset().mockResolvedValue([{ id: 1, periodMonth: '2026-08' }]);
});

describe('GET /audit-report/export', () => {
  it('records a csv run for the request user and returns the download', async () => {
    const res = await app().request('/audit-report/export?period=2026-08&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('audit-report-2026-08-');
    expect(await res.text()).toContain('"finance","spend_usd","10"');
    expect(runs.recordAuditReportRun).toHaveBeenCalledTimes(1);
    const [, , input] = runs.recordAuditReportRun.mock.calls[0]!;
    expect(input).toEqual({ tenantId: TENANT, periodMonth: '2026-08', generatedBy: USER, report, format: 'csv' });
  });

  it('records a json run and returns the report body', async () => {
    const res = await app().request('/audit-report/export?period=2026-08&format=json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report);
    expect(runs.recordAuditReportRun.mock.calls[0]![2].format).toBe('json');
  });
});

describe('GET /audit-report/runs', () => {
  it('returns the tenant runs, bounding limit', async () => {
    const res = await app().request('/audit-report/runs?limit=500');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [{ id: 1, periodMonth: '2026-08' }] });
    expect(runs.listAuditReportRuns.mock.calls[0]!.slice(2)).toEqual([TENANT, { limit: 100 }]);
  });
});

describe('GET /audit-report (cached)', () => {
  it('never records a run', async () => {
    const res = await app().request('/audit-report?period=2026-08');
    expect(res.status).toBe(200);
    expect(runs.recordAuditReportRun).not.toHaveBeenCalled();
  });
});

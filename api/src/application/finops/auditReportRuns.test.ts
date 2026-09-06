/**
 * The run log is only worth having if (a) a recorded row carries the figures the
 * auditor actually took away, and (b) the list a reader sees is fresh after a
 * new export. So: the summary projection, the newest-first bounded list served
 * through the cache, and the write invalidating exactly the key the read uses.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { AuditReport } from './auditReport';
import { listAuditReportRuns, recordAuditReportRun, summarizeAuditReport } from './auditReportRuns';

const env = {} as Env;

const report: AuditReport = {
  generatedAt: '2026-09-06T10:00:00.000Z',
  period: '2026-08',
  windowDays: 30,
  finance: { spendUsd: 1234.5, forecastUsd: 1500, paidOverflowUsd: 0, costPerMergedPrUsd: 12.3 },
  allocation: { hours: 80, capexUsd: 600, opexUsd: 400, capitalizablePct: 60 },
  rdTaxCredit: { qualifiedHours: 40, blendedRate: 90, qualifiedLaborUsd: 3600, qualifiedAiSpendUsd: 100, qualifiedBaseUsd: 3700 },
  socControls: { total: 10, implemented: 7, partial: 2, gap: 1, coveragePct: 70 },
  compliance: { windowDays: 30, totalEvents: 512, sensitiveEvents: 9, distinctExecutions: 40, distinctAgents: 3 },
};

function makeDb(rows: Array<Record<string, unknown>> = []) {
  const captured: { inserted?: Record<string, unknown> } = {};
  const calls = { loads: 0 };
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.inserted = v;
        return { returning: async () => [{ id: 9, ...v, createdAt: new Date('2026-09-06T10:00:01.000Z') }] };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async (n: number) => {
              calls.loads += 1;
              return rows.slice(0, n);
            },
          }),
        }),
      }),
    }),
  } as unknown as Db;
  return { db, captured, calls };
}

describe('summarizeAuditReport', () => {
  it('keeps the headline figures, the format and the window', () => {
    expect(summarizeAuditReport(report, 'csv')).toEqual({
      format: 'csv', windowDays: 30, generatedAt: '2026-09-06T10:00:00.000Z',
      spendUsd: 1234.5, forecastUsd: 1500, capexUsd: 600, opexUsd: 400,
      qualifiedBaseUsd: 3700, socCoveragePct: 70, complianceEvents: 512,
    });
  });
});

describe('recordAuditReportRun', () => {
  it('inserts one row with the summary and returns the run', async () => {
    const { db, captured } = makeDb();
    const run = await recordAuditReportRun(db, env, { tenantId: 3, periodMonth: '2026-08', generatedBy: 'user-1', report, format: 'json' });
    expect(captured.inserted).toMatchObject({ tenantId: 3, periodMonth: '2026-08', generatedBy: 'user-1' });
    expect((captured.inserted!.summary as { format: string }).format).toBe('json');
    expect(run).toMatchObject({ id: 9, periodMonth: '2026-08', generatedBy: 'user-1', createdAt: '2026-09-06T10:00:01.000Z' });
    expect(run.summary?.spendUsd).toBe(1234.5);
  });
});

describe('listAuditReportRuns', () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: 3 - i, tenantId: 3, periodMonth: '2026-08', generatedBy: null, summary: null, createdAt: new Date(2026, 8, 6 - i),
  }));

  it('serves repeat reads from the cache and slices the caller limit off ONE cached window', async () => {
    const { db, calls } = makeDb(rows);
    const all = await listAuditReportRuns(db, env, 3);
    expect(all.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(all[0]?.createdAt).toMatch(/^2026-09-0[56]T/);
    const two = await listAuditReportRuns(db, env, 3, { limit: 2 });
    expect(two).toHaveLength(2);
    expect(calls.loads).toBe(1);
  });

  it('reloads after a run is recorded (the writer invalidates the reader key)', async () => {
    const { db, calls } = makeDb(rows);
    await listAuditReportRuns(db, env, 3);
    await recordAuditReportRun(db, env, { tenantId: 3, periodMonth: '2026-08', generatedBy: null, report, format: 'csv' });
    await listAuditReportRuns(db, env, 3);
    expect(calls.loads).toBe(2);
  });

  it('does not cross tenants', async () => {
    const { db, calls } = makeDb(rows);
    await listAuditReportRuns(db, env, 3);
    await listAuditReportRuns(db, env, 4);
    expect(calls.loads).toBe(2);
  });
});

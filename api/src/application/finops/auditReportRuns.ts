/**
 * Audit-report RUNS — the log beside `assembleAuditReport`.
 *
 * `audit_report_runs` (migration 0233) is "an optional record of an assembled
 * period report": the report itself is computed live and never stored, so the
 * row records THAT a period was assembled, by whom, in which format, with the
 * headline figures it carried at that moment. The honest logging moment is the
 * EXPORT — the deliberately uncached point-in-time snapshot an auditor takes
 * away. The cached `GET /audit-report` must NOT log: it would record only cache
 * misses, which is a log of the cache, not of the audit.
 *
 * Reads are served through the canonical read-through cache under ONE key per
 * tenant; the single writer invalidates it.
 */

import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { auditReportRuns } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { AuditReport } from './auditReport';

export type AuditReportFormat = 'csv' | 'json';

/** The figures a run row keeps — enough to read the log without re-assembling. */
export interface AuditReportRunSummary {
  format: AuditReportFormat;
  windowDays: number;
  generatedAt: string;
  spendUsd: number;
  forecastUsd: number;
  capexUsd: number;
  opexUsd: number;
  qualifiedBaseUsd: number;
  socCoveragePct: number;
  complianceEvents: number;
}

export interface AuditReportRun {
  id: number;
  periodMonth: string;
  generatedBy: string | null;
  summary: AuditReportRunSummary | null;
  createdAt: string;
}

export interface RecordAuditReportRunInput {
  tenantId: number;
  periodMonth: string;
  generatedBy: string | null;
  report: AuditReport;
  format: AuditReportFormat;
}

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const auditReportRunsCacheKey = (tenantId: number): string => `finops:auditruns:t:${tenantId}`;

/** Project the report's top-level figures onto the stored summary. */
export function summarizeAuditReport(report: AuditReport, format: AuditReportFormat): AuditReportRunSummary {
  return {
    format,
    windowDays: report.windowDays,
    generatedAt: report.generatedAt,
    spendUsd: report.finance.spendUsd,
    forecastUsd: report.finance.forecastUsd,
    capexUsd: report.allocation.capexUsd,
    opexUsd: report.allocation.opexUsd,
    qualifiedBaseUsd: report.rdTaxCredit.qualifiedBaseUsd,
    socCoveragePct: report.socControls.coveragePct,
    complianceEvents: report.compliance.totalEvents,
  };
}

/** Log one assembled report and invalidate the tenant's run list. */
export async function recordAuditReportRun(db: Db, env: Env, input: RecordAuditReportRunInput): Promise<AuditReportRun> {
  const summary = summarizeAuditReport(input.report, input.format);
  const [row] = await db
    .insert(auditReportRuns)
    .values({ tenantId: input.tenantId, periodMonth: input.periodMonth, generatedBy: input.generatedBy, summary })
    .returning();
  await invalidateCached(env, auditReportRunsCacheKey(input.tenantId));
  return toRun(row!);
}

/**
 * Newest first, bounded. ONE cache key per tenant — the loader reads the maximum
 * window and the caller's `limit` is a slice of it — so the writer's invalidation
 * names exactly the key the reader uses, with no per-limit fan-out to enumerate.
 */
export async function listAuditReportRuns(db: Db, env: Env, tenantId: number, opts: { limit?: number } = {}): Promise<AuditReportRun[]> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const runs = await getOrSetCached(env, auditReportRunsCacheKey(tenantId), async () => {
    const rows = await db
      .select()
      .from(auditReportRuns)
      .where(eq(auditReportRuns.tenantId, tenantId))
      .orderBy(desc(auditReportRuns.createdAt), desc(auditReportRuns.id))
      .limit(MAX_LIMIT);
    return rows.map(toRun);
  }, SHORT_TTL);
  return runs.slice(0, limit);
}

function toRun(row: typeof auditReportRuns.$inferSelect): AuditReportRun {
  return {
    id: row.id,
    periodMonth: row.periodMonth,
    generatedBy: row.generatedBy ?? null,
    summary: (row.summary as AuditReportRunSummary | null) ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

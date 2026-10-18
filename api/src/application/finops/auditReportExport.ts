/**
 * The audit-report export source — `GET /api/finops/audit-report/export`.
 *
 * The export is the one honest logging moment: a deliberate point-in-time
 * snapshot an auditor takes away, so loading it RECORDS the run (who, which
 * period, which format). The cached `GET /audit-report` must not log — it would
 * only ever record cache misses. Serialising and the response are
 * `export/exportSource`'s, like every other download.
 */
import { TenantRole } from '../../domain/shared/types';
import { periodParam } from '../../domain/shared/period';
import { exportStamp, type TenantExportSource } from '../export/exportSource';
import { assembleAuditReport, auditReportTable } from './auditReport';
import { recordAuditReportRun } from './auditReportRuns';

export const auditReportExportSource: TenantExportSource = {
  id: 'finops.audit-report',
  label: 'Audit-ready report',
  scope: 'tenant',
  minRole: TenantRole.MANAGER,
  formats: ['csv', 'json', 'xlsx'],
  async load(ctx, format) {
    const period = periodParam(ctx.param('period'), ctx.now);
    const report = await assembleAuditReport(ctx.db, ctx.tenantId, ctx.segmentId, period);
    await recordAuditReportRun(ctx.db, ctx.env, {
      tenantId: ctx.tenantId,
      periodMonth: period,
      generatedBy: ctx.userId,
      report,
      // The run log's vocabulary is the two formats it has always recorded; a
      // workbook is the CSV's rows in another container.
      format: format === 'json' ? 'json' : 'csv',
    });
    return {
      filename: `audit-report-${period}-${exportStamp(ctx.now)}`,
      title: `Audit report ${period}`,
      table: auditReportTable(report),
      json: report,
    };
  },
};

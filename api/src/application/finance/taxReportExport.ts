/**
 * The 1099 year-end export source — `GET /api/tax/report/:year/csv`.
 *
 * A MANAGER surface: it lists every recipient's legal name, address and tax-id
 * last-four, the workspace's most sensitive aggregate. `?all=true` is the
 * reconciliation view — every recipient, including those under the threshold,
 * with the audit reason for each; the default is the filer-ready reportable set,
 * because shipping below-threshold recipients would file forms for people who
 * must not receive one.
 */
import { TenantRole } from '../../domain/shared/types';
import { ValidationError } from '../../domain/shared/errors';
import type { TenantExportSource } from '../export/exportSource';
import { isReportableYear } from '../../domain/finance/taxThreshold';
import { buildTaxYearReport, taxYearReportFilename, taxYearReportTable } from './taxReport';

export const taxYearExportSource: TenantExportSource = {
  id: 'tax.year-report',
  label: '1099 year-end report',
  scope: 'tenant',
  minRole: TenantRole.MANAGER,
  formats: ['csv', 'xlsx'],
  async load(ctx) {
    const year = Number(ctx.param('year'));
    const onlyReportable = ctx.param('all') !== 'true';
    // Validate up front: a database failure must surface as one, not be relabelled
    // "not a reportable year" by a blanket catch.
    if (!isReportableYear(year)) throw new ValidationError('That is not a reportable tax year.');
    const report = await buildTaxYearReport(ctx.db, ctx.env, ctx.tenantId, year);
    return {
      filename: taxYearReportFilename(year, onlyReportable),
      title: `Tax year ${year}`,
      table: taxYearReportTable(report, { onlyReportable }),
    };
  },
};

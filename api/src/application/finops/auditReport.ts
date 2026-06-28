/**
 * Audit-Ready Reports — assemble ONE period report an auditor can take away:
 *   - finance totals (FinOps spend / forecast for the month),
 *   - allocation capex/opex split (software-capitalization evidence),
 *   - R&D QRE summary (qualified hours / labor / AI spend / base),
 *   - SOC 1 control coverage (% implemented + per-status counts),
 *   - compliance evidence counts (immutable tool-audit trail volume + sensitivity).
 *
 * Every leg reuses an existing engine — this module is pure composition + CSV.
 */

import type { Db } from '../../infrastructure/database/connection';
import { computeFinanceInsights } from '../insights/financeInsights';
import { computeAllocationInsights } from '../insights/allocationInsights';
import { computeComplianceSummary } from '../insights/complianceInsights';
import { computeRdTaxCredit } from './rdTaxCredit';
import { computeControlCoverage } from './socControls';

/** Trailing window (days) used for the allocation / R&D / compliance legs. */
const REPORT_WINDOW_DAYS = 30;

export interface AuditReport {
  generatedAt: string;
  period: string;
  windowDays: number;
  finance: {
    spendUsd: number;
    forecastUsd: number;
    paidOverflowUsd: number;
    costPerMergedPrUsd: number | null;
  };
  allocation: {
    hours: number;
    capexUsd: number;
    opexUsd: number;
    capitalizablePct: number;
  };
  rdTaxCredit: {
    qualifiedHours: number;
    blendedRate: number;
    qualifiedLaborUsd: number;
    qualifiedAiSpendUsd: number;
    qualifiedBaseUsd: number;
  };
  socControls: {
    total: number;
    implemented: number;
    partial: number;
    gap: number;
    coveragePct: number;
  };
  compliance: {
    windowDays: number;
    totalEvents: number;
    sensitiveEvents: number;
    distinctExecutions: number;
    distinctAgents: number;
  };
}

export async function assembleAuditReport(
  db: Db,
  tenantId: number,
  segmentId: string,
  period: string,
): Promise<AuditReport> {
  const now = Date.now();
  const [finance, allocation, rd, soc, compliance] = await Promise.all([
    computeFinanceInsights(db, tenantId, segmentId, period, now),
    computeAllocationInsights(db, tenantId, REPORT_WINDOW_DAYS, now),
    computeRdTaxCredit(db, tenantId, period, REPORT_WINDOW_DAYS),
    computeControlCoverage(db, tenantId),
    computeComplianceSummary(db, tenantId, REPORT_WINDOW_DAYS),
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    period,
    windowDays: REPORT_WINDOW_DAYS,
    finance: {
      spendUsd: finance.totals.spendUsd,
      forecastUsd: finance.totals.forecastUsd,
      paidOverflowUsd: finance.totals.paidOverflowUsd,
      costPerMergedPrUsd: finance.totals.costPerMergedPrUsd,
    },
    allocation: {
      hours: allocation.totals.hours,
      capexUsd: allocation.totals.capexUsd,
      opexUsd: allocation.totals.opexUsd,
      capitalizablePct: allocation.totals.capitalizablePct,
    },
    rdTaxCredit: {
      qualifiedHours: rd.qualifiedHours,
      blendedRate: rd.blendedRate,
      qualifiedLaborUsd: rd.qualifiedLaborUsd,
      qualifiedAiSpendUsd: rd.qualifiedAiSpendUsd,
      qualifiedBaseUsd: rd.qualifiedBaseUsd,
    },
    socControls: {
      total: soc.total,
      implemented: soc.implemented,
      partial: soc.partial,
      gap: soc.gap,
      coveragePct: soc.coveragePct,
    },
    compliance: {
      windowDays: compliance.windowDays,
      totalEvents: compliance.totalEvents,
      sensitiveEvents: compliance.sensitiveEvents,
      distinctExecutions: compliance.distinctExecutions,
      distinctAgents: compliance.distinctAgents,
    },
  };
}

/** Flatten the report into a section/metric/value CSV (RFC-4180-ish). */
export function auditReportToCsv(report: AuditReport): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const round = (n: number) => Math.round(n * 100) / 100;
  const rows: Array<[string, string, string | number]> = [
    ['meta', 'period', report.period],
    ['meta', 'generated_at', report.generatedAt],
    ['meta', 'window_days', report.windowDays],
    ['finance', 'spend_usd', round(report.finance.spendUsd)],
    ['finance', 'forecast_usd', round(report.finance.forecastUsd)],
    ['finance', 'paid_overflow_usd', round(report.finance.paidOverflowUsd)],
    ['finance', 'cost_per_merged_pr_usd', report.finance.costPerMergedPrUsd == null ? '' : round(report.finance.costPerMergedPrUsd)],
    ['allocation', 'effort_hours', round(report.allocation.hours)],
    ['allocation', 'capex_usd', round(report.allocation.capexUsd)],
    ['allocation', 'opex_usd', round(report.allocation.opexUsd)],
    ['allocation', 'capitalizable_pct', round(report.allocation.capitalizablePct)],
    ['rd_tax_credit', 'qualified_hours', round(report.rdTaxCredit.qualifiedHours)],
    ['rd_tax_credit', 'blended_rate_usd', round(report.rdTaxCredit.blendedRate)],
    ['rd_tax_credit', 'qualified_labor_usd', round(report.rdTaxCredit.qualifiedLaborUsd)],
    ['rd_tax_credit', 'qualified_ai_spend_usd', round(report.rdTaxCredit.qualifiedAiSpendUsd)],
    ['rd_tax_credit', 'qualified_base_usd', round(report.rdTaxCredit.qualifiedBaseUsd)],
    ['soc_controls', 'total', report.socControls.total],
    ['soc_controls', 'implemented', report.socControls.implemented],
    ['soc_controls', 'partial', report.socControls.partial],
    ['soc_controls', 'gap', report.socControls.gap],
    ['soc_controls', 'coverage_pct', round(report.socControls.coveragePct)],
    ['compliance', 'total_events', report.compliance.totalEvents],
    ['compliance', 'sensitive_events', report.compliance.sensitiveEvents],
    ['compliance', 'distinct_executions', report.compliance.distinctExecutions],
    ['compliance', 'distinct_agents', report.compliance.distinctAgents],
  ];
  const header = ['section', 'metric', 'value'];
  const lines = rows.map((r) => r.map(esc).join(','));
  return [header.join(','), ...lines].join('\n');
}

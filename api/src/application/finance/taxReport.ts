/**
 * THE YEAR-END 1099 REPORT — one calendar year of payouts, per recipient.
 *
 * Read-only, and safe to run repeatedly during the close window: it writes to no
 * table and decrypts nothing. Its two responsibilities are aggregation and
 * presentation; WHO is reportable is `domain/finance/taxThreshold` and WHAT a
 * payee's facts are is `taxProfile` — this module composes them and nothing else.
 *
 * ── WHY THE LEDGER IS THE SOURCE ────────────────────────────────────────────
 * `PayoutAccountService` establishes the earned/paid split: the domain holds what
 * is OWED, and `ledger_entries` holds only money that actually MOVED
 * (`entry_kind = 'payout'`). A 1099 reports money that moved, so the ledger is
 * the whole source and there is nothing to reconcile against a second table.
 *
 * ── TWO QUERIES, NEVER N+1 ──────────────────────────────────────────────────
 * One grouped aggregate over the year, then one batched profile load for the
 * recipients it returned. A per-recipient profile read would be an N+1 over a
 * table that grows with the platform's payee count, on a page an accountant
 * refreshes. The aggregate is served by `idx_ledger_entries_payout_year`
 * (migration 1117) — the index that exists because the pre-existing account
 * index leads with `account_ref` and so cannot answer an all-recipients scan.
 */

import { eq, gte, lt, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ledgerEntries } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { taxReportVersionKey } from './taxCacheVersion';
import { csvMatrix } from '../export/tabularExport';
import { USD_CENTS } from '../kernel/denominations';
import {
  calendarYearBounds,
  evaluateThreshold,
  isReportableYear,
  type RecipientType,
} from '../../domain/finance/taxThreshold';
import { getTaxProfilesFor, type TaxProfile } from './taxProfile';

export interface TaxYearReportRow {
  userId: string;
  recipientType: RecipientType;
  legalName: string | null;
  businessName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  taxIdLast4: string | null;
  taxIdType: string | null;
  taxResidencyCountry: string | null;
  formType: '1099-NEC' | '1042-S';
  totalPaidCents: number;
  totalPaidUsd: number;
  payoutCount: number;
  reportable: boolean;
  /** Why this row is in or out — carried into the CSV for a human spot-check. */
  thresholdReason: string;
  /** A reportable recipient whose W-9 is incomplete cannot actually be filed. */
  profileComplete: boolean;
}

export interface TaxYearReport {
  year: number;
  periodStart: string;
  periodEnd: string;
  totalRecipients: number;
  reportableRecipients: number;
  reportableCents: number;
  /** Reportable recipients whose profile is missing something. The number that
   *  matters operationally: each one is a filing that cannot be submitted. */
  blockedRecipients: number;
  rows: TaxYearReportRow[];
}

/** Cents from the ledger's `numeric` column, which arrives as a string. */
function toCents(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : Number(raw ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Assemble one year's report. Cached under the workspace's version token. */
export async function buildTaxYearReport(
  db: Db,
  env: Env | undefined,
  tenantId: number,
  year: number,
): Promise<TaxYearReport> {
  if (!isReportableYear(year)) throw new Error('year must be a four-digit calendar year between 2020 and 2100');

  const version = env ? await getCacheVersion(env, taxReportVersionKey(tenantId)) : '0';
  return getOrSetCached(env, `tax:report:${tenantId}:${year}:${version}`,
    () => loadTaxYearReport(db, tenantId, year),
    { kvTtlSeconds: 900 });
}

async function loadTaxYearReport(db: Db, tenantId: number, year: number): Promise<TaxYearReport> {
  const { start, end } = calendarYearBounds(year);

  // `ABS`, matching `PayoutAccountService.available()` which sums payouts the
  // same way. The sign on a payout row is NOT consistent across writers — the
  // direct payout path writes it positive, an escrow release writes it through a
  // signed movement — and a 1099 reports a magnitude either way. Summing raw
  // would let the two writers cancel each other out inside one recipient's year.
  const aggregates = await db
    .select({
      accountRef: ledgerEntries.accountRef,
      totalCents: sql<string>`ABS(COALESCE(SUM(${ledgerEntries.amount}), 0))`,
      payoutCount: sql<number>`COUNT(*)::int`,
    })
    .from(ledgerEntries)
    .where(scopedToTenant(ledgerEntries, tenantId,
      eq(ledgerEntries.entryKind, 'payout'),
      eq(ledgerEntries.denomination, USD_CENTS),
      gte(ledgerEntries.occurredAt, start),
      lt(ledgerEntries.occurredAt, end),
    ))
    .groupBy(ledgerEntries.accountRef);

  const empty: TaxYearReport = {
    year,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    totalRecipients: 0,
    reportableRecipients: 0,
    reportableCents: 0,
    blockedRecipients: 0,
    rows: [],
  };
  if (aggregates.length === 0) return empty;

  const profiles = await getTaxProfilesFor(db, tenantId, aggregates.map((a) => a.accountRef));

  const rows = aggregates
    .map((a) => buildRow(a.accountRef, toCents(a.totalCents), Number(a.payoutCount ?? 0), profiles.get(a.accountRef)))
    // Largest first: the accountant works down the list, and the biggest filing
    // is the one worth checking before the close deadline.
    .sort((x, y) => y.totalPaidCents - x.totalPaidCents);

  const reportable = rows.filter((r) => r.reportable);
  return {
    ...empty,
    totalRecipients: rows.length,
    reportableRecipients: reportable.length,
    reportableCents: reportable.reduce((sum, r) => sum + r.totalPaidCents, 0),
    blockedRecipients: reportable.filter((r) => !r.profileComplete).length,
    rows,
  };
}

/** One recipient's line: their money, their facts, and the threshold verdict. */
function buildRow(
  userId: string,
  totalPaidCents: number,
  payoutCount: number,
  profile: TaxProfile | undefined,
): TaxYearReportRow {
  const verdict = evaluateThreshold(totalPaidCents, profile?.taxResidencyCountry);
  return {
    userId,
    recipientType: profile?.recipientType ?? 'unknown',
    legalName: profile?.legalName ?? null,
    businessName: profile?.businessName ?? null,
    addressLine1: profile?.addressLine1 ?? null,
    addressLine2: profile?.addressLine2 ?? null,
    addressCity: profile?.addressCity ?? null,
    addressRegion: profile?.addressRegion ?? null,
    addressPostalCode: profile?.addressPostalCode ?? null,
    addressCountry: profile?.addressCountry ?? null,
    taxIdLast4: profile?.taxIdLast4 ?? null,
    taxIdType: profile?.taxIdType ?? null,
    taxResidencyCountry: profile?.taxResidencyCountry ?? null,
    formType: verdict.formType,
    totalPaidCents,
    totalPaidUsd: totalPaidCents / 100,
    payoutCount,
    reportable: verdict.reportable,
    thresholdReason: verdict.reason,
    profileComplete: profile?.complete ?? false,
  };
}

/** The bulk-filer column set. Ordered to match Track1099 / Tax1099 uploads. */
const CSV_HEADER = [
  'Recipient Type', 'Recipient Name', 'Business Name',
  'Address Line 1', 'Address Line 2', 'City', 'State / Region', 'Postal Code', 'Country',
  'Tax ID Last 4', 'Tax ID Type', 'Tax Form Type',
  'Total Paid USD', 'Payout Count', 'Profile Complete', 'Audit Reason',
] as const;

/**
 * Render the report as a filer-ready CSV.
 *
 * The columns are this module's; the ESCAPING is `csvMatrix`, the api's one CSV
 * writer — a report that quotes a comma in a street address differently from
 * every other export is how a spreadsheet silently shifts a column.
 *
 * `onlyReportable` defaults to true: the file exists to be uploaded to a filer,
 * and shipping the below-threshold recipients by default would file forms for
 * people who must not receive one. Pass false for the reconciliation view.
 */
export function taxYearReportToCsv(report: TaxYearReport, opts?: { onlyReportable?: boolean }): string {
  const rows = opts?.onlyReportable === false ? report.rows : report.rows.filter((r) => r.reportable);
  return csvMatrix(CSV_HEADER, rows.map((r) => [
    r.recipientType, r.legalName, r.businessName,
    r.addressLine1, r.addressLine2, r.addressCity, r.addressRegion, r.addressPostalCode, r.addressCountry,
    r.taxIdLast4, r.taxIdType, r.formType,
    r.totalPaidUsd.toFixed(2), r.payoutCount, r.profileComplete ? 'yes' : 'no', r.thresholdReason,
  ]));
}

/** The filename a download offers. Named so a year's files sort together. */
export function taxYearReportFilename(year: number, onlyReportable: boolean): string {
  return `tax-${year}-${onlyReportable ? 'filings' : 'all-recipients'}.csv`;
}

/** Every year that has at least one payout — what the year picker offers. */
export async function listTaxYears(db: Db, env: Env | undefined, tenantId: number): Promise<number[]> {
  const version = env ? await getCacheVersion(env, taxReportVersionKey(tenantId)) : '0';
  return getOrSetCached(env, `tax:years:${tenantId}:${version}`, async () => {
    const rows = await db
      .select({ year: sql<number>`EXTRACT(YEAR FROM ${ledgerEntries.occurredAt})::int` })
      .from(ledgerEntries)
      .where(scopedToTenant(ledgerEntries, tenantId,
        eq(ledgerEntries.entryKind, 'payout'),
        eq(ledgerEntries.denomination, USD_CENTS),
      ))
      .groupBy(sql`EXTRACT(YEAR FROM ${ledgerEntries.occurredAt})`)
      .orderBy(sql`EXTRACT(YEAR FROM ${ledgerEntries.occurredAt}) DESC`);
    return rows.map((r) => Number(r.year)).filter(isReportableYear);
  }, { kvTtlSeconds: 900 });
}

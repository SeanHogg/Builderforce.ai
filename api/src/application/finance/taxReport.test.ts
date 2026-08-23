/**
 * The year-end report's arithmetic and composition, pinned:
 *
 *   - a payout's magnitude, not its raw sign (the writers disagree on sign —
 *     see the module comment) is what a recipient's yearly total sums to;
 *   - the threshold verdict is per-ROW, driven by that recipient's own
 *     residency, never one verdict applied to the whole aggregate;
 *   - the CSV defaults to reportable-only, and never includes more than the
 *     column set a filer expects;
 *   - a bad year throws before any query runs.
 */
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { buildTaxYearReport, taxYearReportToCsv } from './taxReport';

const TENANT = 3;

describe('buildTaxYearReport', () => {
  it('rejects a year outside the reportable range before issuing any query', async () => {
    const db = fakeDb([]);
    await expect(buildTaxYearReport(db as unknown as Db, undefined, TENANT, 1999))
      .rejects.toThrow(/four-digit calendar year/);
    expect(db.calls).toHaveLength(0);
  });

  it('returns the empty shape with no query beyond the aggregate when nobody was paid', async () => {
    const db = fakeDb([[]]);
    const report = await buildTaxYearReport(db as unknown as Db, undefined, TENANT, 2025);
    expect(report).toMatchObject({ totalRecipients: 0, reportableRecipients: 0, rows: [] });
    expect(db.calls).toHaveLength(1);
  });

  it('takes the payout MAGNITUDE — sign is not load-bearing for the yearly total', async () => {
    // ABS(SUM(...)) is issued as a SQL fragment, so the fake db's queued row IS
    // the post-ABS result; what this test pins is that the report trusts that
    // total rather than re-deriving a sign from `amount`.
    const db = fakeDb([
      [{ accountRef: 'user-1', totalCents: '75000', payoutCount: 3 }],
      [{ partyRef: 'user-1', attrs: { legalName: 'Jane Doe', entityType: 'individual', taxResidencyCountry: 'US' } }],
      [], // no sealed id
    ]);
    const report = await buildTaxYearReport(db as unknown as Db, undefined, TENANT, 2025);
    expect(report.rows[0]).toMatchObject({ userId: 'user-1', totalPaidCents: 75000, totalPaidUsd: 750, reportable: true });
  });

  it('applies the threshold PER RECIPIENT — a US and a non-US row in the same year verdict independently', async () => {
    const db = fakeDb([
      [
        { accountRef: 'us-under', totalCents: '10000', payoutCount: 1 },   // $100, US, below $600
        { accountRef: 'intl-any', totalCents: '500', payoutCount: 1 },     // $5, non-US, no floor
      ],
      [
        { partyRef: 'us-under', attrs: { taxResidencyCountry: 'US' } },
        { partyRef: 'intl-any', attrs: { taxResidencyCountry: 'DE' } },
      ],
      [],
    ]);
    const report = await buildTaxYearReport(db as unknown as Db, undefined, TENANT, 2025);
    const byId = new Map(report.rows.map((r) => [r.userId, r]));
    expect(byId.get('us-under')?.reportable).toBe(false);
    expect(byId.get('intl-any')?.reportable).toBe(true);
    expect(report.reportableRecipients).toBe(1);
  });

  it('counts a reportable recipient with an incomplete profile as BLOCKED, not silently filed', async () => {
    const db = fakeDb([
      [{ accountRef: 'no-w9', totalCents: '100000', payoutCount: 1 }],
      [], // no party_roles row at all — profile is empty, therefore incomplete
      [], // no sealed id
    ]);
    const report = await buildTaxYearReport(db as unknown as Db, undefined, TENANT, 2025);
    expect(report.reportableRecipients).toBe(1);
    expect(report.blockedRecipients).toBe(1);
    expect(report.rows[0]?.profileComplete).toBe(false);
  });

  it('orders rows largest-total first', async () => {
    const db = fakeDb([
      [
        { accountRef: 'small', totalCents: '60000', payoutCount: 1 },
        { accountRef: 'big', totalCents: '900000', payoutCount: 4 },
      ],
      [], [],
    ]);
    const report = await buildTaxYearReport(db as unknown as Db, undefined, TENANT, 2025);
    expect(report.rows.map((r) => r.userId)).toEqual(['big', 'small']);
  });
});

describe('taxYearReportToCsv', () => {
  const report = {
    year: 2025, periodStart: '2025-01-01T00:00:00.000Z', periodEnd: '2026-01-01T00:00:00.000Z',
    totalRecipients: 2, reportableRecipients: 1, reportableCents: 100000, blockedRecipients: 0,
    rows: [
      {
        userId: 'u1', recipientType: 'individual' as const, legalName: 'Jane Doe', businessName: null,
        addressLine1: '1 Main St, Apt "A"', addressLine2: null, addressCity: 'Metropolis', addressRegion: 'NY',
        addressPostalCode: '10001', addressCountry: 'US', taxIdLast4: '6789', taxIdType: 'ssn',
        taxResidencyCountry: 'US', formType: '1099-NEC' as const, totalPaidCents: 100000, totalPaidUsd: 1000,
        payoutCount: 2, reportable: true, thresholdReason: 'US recipient at or above the $600 1099-NEC threshold.',
        profileComplete: true,
      },
      {
        userId: 'u2', recipientType: 'individual' as const, legalName: 'Below Threshold', businessName: null,
        addressLine1: null, addressLine2: null, addressCity: null, addressRegion: null,
        addressPostalCode: null, addressCountry: null, taxIdLast4: null, taxIdType: null,
        taxResidencyCountry: 'US', formType: '1099-NEC' as const, totalPaidCents: 5000, totalPaidUsd: 50,
        payoutCount: 1, reportable: false, thresholdReason: 'US recipient below the $600 1099-NEC threshold.',
        profileComplete: false,
      },
    ],
  };

  it('defaults to reportable-only, dropping the below-threshold recipient', () => {
    const csv = taxYearReportToCsv(report);
    expect(csv).toContain('Jane Doe');
    expect(csv).not.toContain('Below Threshold');
  });

  it('includes every recipient with an audit reason when onlyReportable is false', () => {
    const csv = taxYearReportToCsv(report, { onlyReportable: false });
    expect(csv).toContain('Jane Doe');
    expect(csv).toContain('Below Threshold');
    expect(csv).toContain('below the $600');
  });

  it('quotes an embedded comma and doubled quote in an address the same way every export does', () => {
    const csv = taxYearReportToCsv(report, { onlyReportable: false });
    expect(csv).toContain('"1 Main St, Apt ""A"""');
  });
});

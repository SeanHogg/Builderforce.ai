/**
 * THE METER — what a vendor may report, and what it may not.
 *
 * Two claims are made to vendors in writing, and both are asserted here:
 *
 *   1. a retried report is counted exactly once, and says so rather than erroring;
 *   2. a vendor chooses WHEN inside the open period, never WHICH invoice.
 *
 * The first is the difference between a vendor who retries safely and one who
 * either loses revenue or reports the same call twice under a new id. The second
 * is the difference between a period that can be reconciled and one where a
 * backdated report lands behind an invoice that has already been sent.
 *
 * Driven through a fake `db` that stands in for the one insert this module makes,
 * so the unique index it relies on is modelled rather than assumed.
 */

import { describe, expect, it } from 'vitest';
import { InstallTokenError } from './extensionInstallTokens';
import { meterAccountRef, recordUsage } from './extensionUsage';

const INSTALL = '11111111-1111-4111-8111-111111111111';

interface Captured {
  tenantId: number;
  accountKind: string;
  accountRef: string;
  denomination: string;
  amount: string;
  entryKind: string;
  reference: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

/**
 * A `db` whose insert honours the real unique index on
 * `(tenant, denomination, reference)` — the index that IS the idempotency, so a
 * fake that ignored it would prove nothing about the property being claimed.
 */
function fakeDb() {
  const rows: Captured[] = [];
  const seen = new Set<string>();
  const db = {
    insert: () => ({
      values: (v: Captured) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            const key = `${v.tenantId}|${v.denomination}|${v.reference}`;
            if (seen.has(key)) return [];
            seen.add(key);
            rows.push(v);
            return [{ id: rows.length }];
          },
        }),
      }),
    }),
  };
  return { db: db as never, rows };
}

const report = (over: Record<string, unknown> = {}) => ({
  tenantId: 42,
  installId: INSTALL,
  packageSlug: 'acme-payroll',
  meteredSince: new Date('2026-08-01T00:00:00Z'),
  report: { usageId: 'run_1', units: 5, note: null, occurredAt: null },
  ...over,
});

describe('recordUsage — idempotency', () => {
  it('records a first report', async () => {
    const { db, rows } = fakeDb();
    const result = await recordUsage(db, report());
    expect(result).toEqual({ recorded: true, units: 5 });
    expect(rows).toHaveLength(1);
  });

  it('counts a retry of the same usageId exactly once, and does not error', async () => {
    // THE claim the docs make to vendors. Erroring would leave them choosing
    // between losing the revenue and reporting it again under a new id, and one
    // of those double-bills a real customer.
    const { db, rows } = fakeDb();
    await recordUsage(db, report());
    const retry = await recordUsage(db, report());
    expect(retry).toEqual({ recorded: false, units: 5 });
    expect(rows).toHaveLength(1);
  });

  it('treats a different usageId as a different occurrence', async () => {
    const { db, rows } = fakeDb();
    await recordUsage(db, report());
    await recordUsage(db, report({ report: { usageId: 'run_2', units: 3, note: null, occurredAt: null } }));
    expect(rows).toHaveLength(2);
  });

  it('scopes the meter to the install, not the workspace', async () => {
    // A workspace running two paid extensions has two meters and two vendors.
    // Summing them together would bill each vendor for the other's calls.
    const { db, rows } = fakeDb();
    await recordUsage(db, report());
    expect(rows[0]?.accountRef).toBe(meterAccountRef(INSTALL));
    expect(rows[0]?.accountKind).toBe('tenant');
    expect(rows[0]?.denomination).toBe('extension_units');
  });

  it('namespaces the reference so a vendor id cannot collide with another install', async () => {
    const { db, rows } = fakeDb();
    await recordUsage(db, report());
    expect(rows[0]?.reference).toBe(`ext-usage:${INSTALL}:run_1`);
  });
});

describe('recordUsage — what a vendor may not do', () => {
  it('refuses a report with no usageId, so nothing is unattributable', async () => {
    const { db } = fakeDb();
    await expect(recordUsage(db, report({ report: { usageId: '', units: 1, note: null, occurredAt: null } })))
      .rejects.toBeInstanceOf(InstallTokenError);
  });

  it('refuses zero, negative and fractional units', async () => {
    const { db } = fakeDb();
    for (const units of [0, -3, 0.4]) {
      await expect(recordUsage(db, report({ report: { usageId: `u${units}`, units, note: null, occurredAt: null } })))
        .rejects.toThrow(/positive whole number/);
    }
  });

  it('refuses an absurd report rather than discovering it on a credit note', async () => {
    // The number becomes a real charge on a real customer's invoice. A vendor bug
    // that reports 10^12 calls has to be refused at the door.
    const { db } = fakeDb();
    await expect(recordUsage(db, report({ report: { usageId: 'huge', units: 10_000_000, note: null, occurredAt: null } })))
      .rejects.toThrow(/may not exceed/);
  });
});

describe('recordUsage — the vendor chooses when, not which invoice', () => {
  it('honours an occurredAt inside the open period', async () => {
    const { db, rows } = fakeDb();
    const inside = new Date('2026-08-14T12:00:00Z');
    await recordUsage(db, report({ report: { usageId: 'a', units: 1, note: null, occurredAt: inside } }));
    expect(rows[0]?.occurredAt.toISOString()).toBe(inside.toISOString());
  });

  it('clamps a BACKDATED report up to the watermark', async () => {
    // Before the watermark is a period that has already been invoiced. A report
    // that landed there would never be picked up by anything — a silent revenue
    // hole for the vendor and an unreconcilable invoice for the customer.
    const { db, rows } = fakeDb();
    const watermark = new Date('2026-08-01T00:00:00Z');
    await recordUsage(db, report({
      meteredSince: watermark,
      report: { usageId: 'old', units: 1, note: null, occurredAt: new Date('2026-06-01T00:00:00Z') },
    }));
    expect(rows[0]?.occurredAt.toISOString()).toBe(watermark.toISOString());
  });

  it('clamps a FUTURE-dated report down to now', async () => {
    // A future report would sit unbilled forever, on the other side of every
    // close that ever runs.
    const { db, rows } = fakeDb();
    const before = Date.now();
    await recordUsage(db, report({
      report: { usageId: 'future', units: 1, note: null, occurredAt: new Date(Date.now() + 86_400_000) },
    }));
    const at = rows[0]!.occurredAt.getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('records the vendor note on the audit trail, never on the invoice line', async () => {
    const { db, rows } = fakeDb();
    await recordUsage(db, report({ report: { usageId: 'n', units: 2, note: 'payroll run 12', occurredAt: null } }));
    expect(rows[0]?.metadata.note).toBe('payroll run 12');
    expect(rows[0]?.metadata.usageId).toBe('n');
  });
});

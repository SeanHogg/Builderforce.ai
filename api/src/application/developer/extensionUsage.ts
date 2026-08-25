/**
 * THE METER — what a vendor reports, and what a period is billed from.
 *
 * PRD 24 §5.4 step 4: "Metered usage is reported back to us; we bill it on the
 * tenant's invoice." This is the first half. `extensionBilling.ts` is the second,
 * and it is the ONLY place a unit ever meets a currency — a unit is not money and
 * must never be reported as though it were.
 *
 * ── WHY THERE IS NO `extension_usage_records` TABLE ─────────────────────────
 * A meter needs four things: an append-only history, an idempotency key (a vendor
 * retries, and a retried report that double-counted would double-bill a real
 * customer), a per-account sum, and a period window. `ledger_entries` has all
 * four, and its unique index on `(tenant, denomination, reference)` makes the
 * idempotency a DATABASE fact rather than a read-then-write check that loses the
 * race it exists for. So a usage report is a ledger row in the `extension_units`
 * denomination — the column PRD 20 §3.2 added precisely so that the sixtieth
 * countable thing is a value rather than DDL.
 *
 * ── THE ACCOUNT ─────────────────────────────────────────────────────────────
 * `(tenant = the installing workspace, accountKind = 'tenant', accountRef =
 * install:<id>)`. Per INSTALL and not per tenant, because a workspace running two
 * paid extensions has two meters and two vendors, and summing them together would
 * bill each vendor for the other's calls.
 *
 * ── WHO MAY WRITE ONE ───────────────────────────────────────────────────────
 * Only the holder of an install-scoped token, which only the publisher of that
 * install's package can mint. That check is `resolveInstallToken`'s and is not
 * repeated here: this module takes an ALREADY-RESOLVED install, so there is no
 * shape of call in which an unauthenticated caller can reach it.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ledgerEntries } from '../../infrastructure/database/schema';
import { EXTENSION_UNITS } from '../kernel/denominations';
import { InstallTokenError } from './extensionInstallTokens';

/** The ledger account a given install's meter is held under. One place. */
export const meterAccountRef = (installId: string): string => `install:${installId}`;

/**
 * The most units one report may claim.
 *
 * A cap, not a rate limit. It exists because the number arrives from a third
 * party and is multiplied by a rate to produce a real charge on a real customer's
 * invoice: a vendor bug that reports 10^12 calls must be refused at the door
 * rather than discovered on a credit note. The bound is generous enough that no
 * honest reporting period reaches it.
 */
const MAX_UNITS_PER_REPORT = 1_000_000;

export interface UsageReport {
  /** The vendor's own id for this occurrence. THE idempotency key. */
  usageId: string;
  units: number;
  /** What the vendor wants on the audit trail. Never shown on the invoice line. */
  note?: string | null;
  /** When it happened, if not now — a vendor batching an hour of calls. */
  occurredAt?: Date | null;
}

export interface RecordedUsage {
  /** False when this exact `usageId` had already been recorded. Not an error. */
  recorded: boolean;
  units: number;
}

/**
 * Record one usage report against an install.
 *
 * ── A DUPLICATE IS A SUCCESS, NOT AN ERROR ──────────────────────────────────
 * A vendor that retries because our response was slow must get the same answer
 * the first call got, or they will either lose usage they are owed for or report
 * it a second time under a new id. So a collision on the reference returns
 * `recorded: false` and a 200 — the platform's word that this occurrence is
 * already counted exactly once.
 *
 * `occurredAt` is accepted from the vendor and CLAMPED to the reporting window
 * rather than trusted: a backdated report could otherwise land before a period
 * that has already been billed, where nothing would ever pick it up, and a
 * future-dated one would sit unbilled forever. Both are silent revenue holes, and
 * both are closed by refusing to let a third party choose which invoice their
 * usage lands on.
 */
export async function recordUsage(
  db: Db,
  input: {
    tenantId: number;
    installId: string;
    packageSlug: string;
    report: UsageReport;
    /** The install's metering watermark. Usage may not be dated before it. */
    meteredSince: Date | null;
  },
): Promise<RecordedUsage> {
  const usageId = input.report.usageId?.trim();
  if (!usageId || usageId.length > 100) {
    throw new InstallTokenError('usageId is required and must be under 100 characters', 400);
  }
  const units = Math.floor(Number(input.report.units));
  if (!Number.isFinite(units) || units <= 0) {
    throw new InstallTokenError('units must be a positive whole number', 400);
  }
  if (units > MAX_UNITS_PER_REPORT) {
    throw new InstallTokenError(`a single report may not exceed ${MAX_UNITS_PER_REPORT} units`, 400);
  }

  const now = new Date();
  const requested = input.report.occurredAt ?? now;
  const floor = input.meteredSince ?? new Date(0);
  // Clamped into [watermark, now] — see the doc comment. A vendor may say WHEN
  // within the open period; they may not say which period.
  const occurredAt = new Date(Math.min(Math.max(requested.getTime(), floor.getTime()), now.getTime()));

  const inserted = await db
    .insert(ledgerEntries)
    .values({
      tenantId: input.tenantId,
      accountKind: 'tenant',
      accountRef: meterAccountRef(input.installId),
      denomination: EXTENSION_UNITS,
      amount: String(units),
      // A meter counts CONSUMPTION, so the entry kind is the ledger's word for it.
      // Positive because the quantity consumed is the fact being recorded; the
      // sign convention that makes a spend negative belongs to balances a tenant
      // draws down, and a usage meter has no balance to exhaust.
      entryKind: 'spend',
      reference: `ext-usage:${input.installId}:${usageId}`,
      memo: `${input.packageSlug} — ${units} unit(s)`.slice(0, 500),
      metadata: {
        source: 'extension_usage',
        installId: input.installId,
        usageId,
        note: input.report.note?.slice(0, 300) ?? null,
      },
      occurredAt,
    })
    .onConflictDoNothing({ target: [ledgerEntries.tenantId, ledgerEntries.denomination, ledgerEntries.reference] })
    .returning({ id: ledgerEntries.id });

  return { recorded: inserted.length > 0, units };
}

/**
 * Units metered against one install in a window.
 *
 * ONE indexed SUM over `idx_ledger_entries_account`, never a fetch-and-add: an
 * install reporting per API call accumulates a lot of rows, and closing its
 * period must not pull them.
 *
 * `until` is exclusive and `since` inclusive, which is what makes consecutive
 * periods tile without double-counting the instant on the boundary — the one
 * off-by-one in billing that produces a customer complaint rather than a bug
 * report.
 */
export async function meteredUnits(
  db: Db,
  tenantId: number,
  installId: string,
  since: Date | null,
  until: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      eq(ledgerEntries.accountKind, 'tenant'),
      eq(ledgerEntries.accountRef, meterAccountRef(installId)),
      eq(ledgerEntries.denomination, EXTENSION_UNITS),
      since ? sql`${ledgerEntries.occurredAt} >= ${since}` : undefined,
      sql`${ledgerEntries.occurredAt} < ${until}`,
    ))
    .limit(1);
  return Math.max(0, Math.floor(Number(row?.total ?? 0)));
}

export interface UsageEvent {
  usageId: string;
  units: number;
  note: string | null;
  occurredAtISO: string;
}

/**
 * The individual reports behind a total — what a disputed invoice is settled with.
 *
 * The whole reason the meter is an append-only ledger rather than a running
 * counter: a customer asking "what are these 1,412 units" gets the 1,412 events,
 * each with the vendor's own id for it, rather than an assurance.
 */
export async function usageEvents(
  db: Db,
  tenantId: number,
  installId: string,
  since: Date | null,
  limit = 100,
): Promise<UsageEvent[]> {
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      eq(ledgerEntries.accountKind, 'tenant'),
      eq(ledgerEntries.accountRef, meterAccountRef(installId)),
      eq(ledgerEntries.denomination, EXTENSION_UNITS),
      since ? sql`${ledgerEntries.occurredAt} >= ${since}` : undefined,
    ))
    .orderBy(desc(ledgerEntries.occurredAt))
    .limit(Math.min(500, Math.max(1, limit)));

  return rows.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      usageId: typeof metadata.usageId === 'string' ? metadata.usageId : '',
      units: Math.round(Number(row.amount) || 0),
      note: typeof metadata.note === 'string' ? metadata.note : null,
      occurredAtISO: row.occurredAt.toISOString(),
    };
  });
}

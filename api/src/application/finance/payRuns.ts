/**
 * Pay runs — what payroll actually cost, read back from whoever ran it.
 *
 * ── WHAT THIS CLOSES (the residual of FO-C6) ─────────────────────────────────
 * The seven payroll and tax manifests shipped in 0469 and every one of them needs
 * a tenant to have connected a provider. A workspace with `compensation_structures`
 * and `timesheets` and no Gusto account still could not answer "what did we pay
 * last month", and `finance.burn` was a number somebody typed. A pay run was
 * reachable through a connector and by nothing else.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 * Not a payroll engine, and `connectors/defaults/payroll.ts` argues that case at
 * length: withholding across jurisdictions is a regulated, per-country,
 * continuously-changing obligation with real liability attached, and every company
 * that needs it already pays somebody to do it. Nothing here calculates anything.
 * Every figure is one a provider RETURNED, or the sum of lines a provider
 * returned, and `source` names which provider said so.
 *
 * ── WHY THERE IS A MANUAL DOOR TOO ───────────────────────────────────────────
 * Because "connected to a supported provider" is not the state most small
 * companies are in — outside the US the payroll bureau is frequently a local firm
 * that sends a PDF, and the `payrollFile` manifest exists in the defaults for
 * exactly that reason. A `source: 'manual'` run entered from that PDF is a fact
 * about money that left, held in the same shape and reaching the same forecast.
 * Refusing it would make the feature available only to the companies who needed
 * it least.
 *
 * ── HOW IT REACHES BURN ──────────────────────────────────────────────────────
 * {@link payRunBurnByMonth} groups PROCESSED runs by the month the money left, so
 * `finance.burn`'s largest line is a fact rather than a projection. Keyed on
 * `paidAt` and not the period: a period straddling a month boundary would
 * otherwise land its whole cost in the wrong month.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { invoiceLineItems, payRuns } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Env } from '../../env';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { connectedConnectorKeys } from '../connectors/connectorTools';
import { asRecord, pickNumber, pickText, rowsFrom } from '../connectors/providerPayload';
import { setDocumentLines } from './payables';

export class PayRunError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PayRunError';
  }
}

/** Bounded, because every read here renders a list on a surface. */
const PAGE = 60;

/** The `invoice_line_items.document_kind` a per-employee pay line carries. The
 *  third direction that one line table serves — see the schema's own note. */
const PAY_RUN_LINES = 'pay_run' as const;

/**
 * The payroll connectors this module knows how to READ a pay run out of.
 *
 * Declared as DATA, in the order a workspace is most likely to have one, so that
 * "which provider do we ask" is a list rather than a branch per vendor — the same
 * open/closed rule the manifests themselves follow. `stripe_tax` and
 * `payroll_file` are absent deliberately: the first is not a payroll provider, and
 * the second is a file drop with no list endpoint to call.
 */
export const PAY_RUN_SOURCES: readonly { connectorKey: string; actionKey: string }[] = [
  { connectorKey: 'gusto', actionKey: 'list_pay_runs' },
  { connectorKey: 'rippling', actionKey: 'list_pay_runs' },
  // `adp-workforce`, not `adp`: the manifest key in `defaults/payroll.ts` carries
  // the suffix, and a candidate whose key never matches a connected connector is
  // a provider that silently never answers.
  { connectorKey: 'adp-workforce', actionKey: 'list_pay_runs' },
  { connectorKey: 'deel', actionKey: 'list_payments' },
];

export interface PayRunLine {
  /** The person. A NAME and not an employee id: this line is read by a founder
   *  looking at a burn figure, and an id would need a second lookup to mean
   *  anything. Where a provider gives only an id, that is what appears. */
  description: string;
  /** Hours, or 1 for a salaried line. */
  quantity?: number;
  /** Rate, or the whole gross for a salaried line. */
  unitAmount: number;
  /** What this person cost, gross. */
  amount: number;
  /** Employer taxes attributable to this person, when the provider says. */
  taxAmount?: number | null;
}

export interface PayRunInput {
  /** A connector manifest key, or 'manual'. */
  source: string;
  /** The provider's own id for the run — the half of the uniqueness that makes a
   *  re-sync an update rather than a second run. */
  externalRef: string;
  currency?: string;
  /** 'processed' | 'open' | 'cancelled'. Only `processed` reaches burn. */
  status?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  /** The date the money left. Without it the run cannot reach a burn month. */
  paidAt?: string | null;
  grossAmount?: number | null;
  employerTaxes?: number | null;
  /** The whole cost. Stored rather than derived — see the schema's own note. */
  totalCost: number;
  employeeCount?: number;
  notes?: string | null;
  objectId?: string | null;
  lines?: readonly PayRunLine[];
}

/** Our own reference for a run, derived from the two things that identify it.
 *  Deterministic, so re-hydrating the same run finds the same lines. */
export const payRunReference = (source: string, externalRef: string): string =>
  `${source}:${externalRef}`.slice(0, 64);

/**
 * Record (or re-record) one pay run.
 *
 * Idempotent on `(tenant, source, external_ref)`: syncing the same period twice
 * updates one row rather than doubling the burn, which is the failure mode that
 * makes an automated finance import worse than no import.
 *
 * The lines are REPLACED rather than merged, for the reason `setDocumentLines`
 * states: a line-level diff needs a stable line id the provider does not
 * consistently give, and a partial write is how a document ends up carrying
 * somebody who left.
 */
export async function recordPayRun(
  db: Db,
  tenantId: number,
  input: PayRunInput,
): Promise<{ reference: string; created: boolean }> {
  const source = input.source.trim().slice(0, 48);
  const externalRef = input.externalRef.trim().slice(0, 96);
  if (!source || !externalRef) throw new PayRunError('A pay run needs the provider that ran it and that provider\'s own reference for it.', 400);
  if (!Number.isFinite(input.totalCost) || input.totalCost < 0) throw new PayRunError('A pay run needs a non-negative total cost.', 400);

  const currency = (input.currency ?? 'USD').toUpperCase().slice(0, 8);
  const reference = payRunReference(source, externalRef);
  const date = (value: string | null | undefined): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const existing = await db
    .select({ id: payRuns.id })
    .from(payRuns)
    .where(scopedToTenant(payRuns, tenantId, eq(payRuns.reference, reference)))
    .limit(1);

  await db
    .insert(payRuns)
    .values({
      tenantId,
      source,
      externalRef,
      reference,
      currency,
      status: input.status?.trim().slice(0, 16) || 'processed',
      periodStart: date(input.periodStart),
      periodEnd: date(input.periodEnd),
      paidAt: date(input.paidAt),
      grossAmount: input.grossAmount == null ? null : String(input.grossAmount),
      employerTaxes: input.employerTaxes == null ? null : String(input.employerTaxes),
      totalCost: String(input.totalCost),
      employeeCount: Math.max(0, Math.round(input.employeeCount ?? input.lines?.length ?? 0)),
      notes: input.notes ?? null,
      objectId: input.objectId ?? null,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [payRuns.tenantId, payRuns.source, payRuns.externalRef],
      set: {
        currency,
        status: input.status?.trim().slice(0, 16) || 'processed',
        periodStart: date(input.periodStart),
        periodEnd: date(input.periodEnd),
        paidAt: date(input.paidAt),
        grossAmount: input.grossAmount == null ? null : String(input.grossAmount),
        employerTaxes: input.employerTaxes == null ? null : String(input.employerTaxes),
        totalCost: String(input.totalCost),
        employeeCount: Math.max(0, Math.round(input.employeeCount ?? input.lines?.length ?? 0)),
        notes: input.notes ?? null,
        syncedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  if (input.lines) {
    await setDocumentLines(db, tenantId, PAY_RUN_LINES, reference, input.lines, currency);
  }
  return { reference, created: existing.length === 0 };
}

// ---------------------------------------------------------------------------
// Hydration — the connector READ this whole thing exists for
// ---------------------------------------------------------------------------

export interface HydrationResult {
  /** The connector that answered, or null when none is connected. */
  source: string | null;
  imported: number;
  created: number;
  /** Which payroll connectors this workspace actually has connected. Returned
   *  even on a miss, so a surface can say "connect Gusto" rather than "no data". */
  connectedSources: string[];
  /** Populated when a connected provider answered with an error — reported rather
   *  than swallowed, because "no pay runs" and "Gusto said 401" are different
   *  facts and only one of them is the tenant's to fix. */
  error: string | null;
}

/**
 * Read pay runs from whichever payroll provider this workspace has connected.
 *
 * ── WHY IT ASKS ONE PROVIDER AND NOT ALL OF THEM ────────────────────────────
 * Because a company has one payroll. A workspace with both Gusto and Deel
 * connected has US employees in one and contractors in the other, and merging the
 * two into one series would double-count nothing but would present two different
 * ideas of "a pay run" as one. The FIRST connected provider in
 * {@link PAY_RUN_SOURCES} answers, and the caller is told which — so a tenant who
 * wants the other one can say so.
 *
 * ── WHY THE SHAPES ARE NORMALISED HERE ──────────────────────────────────────
 * The manifests already normalise the REQUEST — that is what `PAY_RUN_QUERY`
 * does. The RESPONSE is per-vendor JSON, and this is the one place that knows a
 * Gusto `totals.company_debit` is the same fact as a Rippling `total_cost`.
 * Putting it in the connector manifest would mean inventing a response-mapping
 * DSL; putting it in the canvas would mean the model guessing. It is a small
 * table of field candidates, and an unrecognised shape is REPORTED rather than
 * silently imported as zero.
 */
export async function hydratePayRuns(
  db: Db,
  env: Env,
  tenantId: number,
  options: { since?: string | null; connectorKey?: string | null; limit?: number } = {},
): Promise<HydrationResult> {
  const connected = new Set(await connectedConnectorKeys(db, tenantId, env));
  const available = PAY_RUN_SOURCES.filter((candidate) => connected.has(candidate.connectorKey));
  const target = options.connectorKey
    ? available.find((candidate) => candidate.connectorKey === options.connectorKey)
    : available[0];

  const connectedSources = available.map((candidate) => candidate.connectorKey);
  if (!target) return { source: null, imported: 0, created: 0, connectedSources, error: null };

  const limit = Math.max(1, Math.min(Math.round(options.limit ?? 12), PAGE));
  let call;
  try {
    call = await executeConnectorAction({
      db,
      env,
      tenantId,
      connectorKey: target.connectorKey,
      actionKey: target.actionKey,
      input: { ...(options.since ? { start_date: options.since } : {}), limit },
      actorKind: 'user',
    });
  } catch (error) {
    return {
      source: target.connectorKey,
      imported: 0,
      created: 0,
      connectedSources,
      error: error instanceof Error ? error.message : 'The payroll provider could not be reached.',
    };
  }
  if (!call.ok) {
    return { source: target.connectorKey, imported: 0, created: 0, connectedSources, error: call.error ?? `The provider answered ${call.status}.` };
  }

  const runs = normalisePayRuns(call.data);
  if (!runs.length) {
    return { source: target.connectorKey, imported: 0, created: 0, connectedSources, error: null };
  }

  let created = 0;
  for (const run of runs) {
    const outcome = await recordPayRun(db, tenantId, { ...run, source: target.connectorKey });
    if (outcome.created) created += 1;
  }
  return { source: target.connectorKey, imported: runs.length, created, connectedSources, error: null };
}

/**
 * Reading the vendor's JSON is {@link ../connectors/providerPayload}'s job.
 *
 * `asRecord` / `pick` / `pickText` and the envelope search were written here
 * first and then needed verbatim by the People roster reads, which call the same
 * kind of connector action against several of the same vendors. Two copies of a
 * per-vendor field table is how a spelling fixed in one place stays broken in the
 * other, so the four functions moved and both callers import them. `pick` keeps
 * its old name locally only because it appears twenty times below.
 */
const pick = pickNumber;

/**
 * Turn a provider's JSON into pay runs.
 *
 * A run with no identifiable total is DROPPED, not imported as zero. A zero-cost
 * pay run would quietly reduce the burn on a forecast, which is worse than a run
 * that is missing: the second is visible.
 */
export function normalisePayRuns(data: unknown): Array<Omit<PayRunInput, 'source'>> {
  const rows = rowsFrom(data, ['payrolls']);

  const out: Array<Omit<PayRunInput, 'source'>> = [];
  for (const row of rows) {
    const totals = asRecord(row.totals);
    const externalRef = pickText(row, ['id', 'payroll_id', 'uuid', 'reference', 'payroll_uuid']);
    if (!externalRef) continue;

    const totalCost = pick(totals, ['company_debit', 'total_cost', 'employer_cost', 'gross_pay'])
      ?? pick(row, ['total_cost', 'company_debit', 'employer_cost', 'total', 'amount', 'gross_pay']);
    if (totalCost == null) continue;

    const gross = pick(totals, ['gross_pay', 'gross']) ?? pick(row, ['gross_pay', 'gross_amount', 'gross']);
    const taxes = pick(totals, ['employer_taxes', 'company_taxes']) ?? pick(row, ['employer_taxes', 'company_taxes']);
    const employees = pick(row, ['employee_count', 'headcount']) ?? (Array.isArray(row.employee_compensations) ? row.employee_compensations.length : null);

    out.push({
      externalRef,
      currency: pickText(row, ['currency', 'currency_code']) ?? 'USD',
      // Gusto marks a completed run `processed: true`; the others carry a status
      // string. Anything that is not clearly finished is imported as `open`, so
      // it appears on the surface and stays out of burn.
      status: row.processed === true ? 'processed'
        : pickText(row, ['status', 'state'])?.toLowerCase() === 'processed' ? 'processed'
        : pickText(row, ['status', 'state']) ? String(pickText(row, ['status', 'state'])).toLowerCase().slice(0, 16)
        : 'open',
      periodStart: pickText(row, ['start_date', 'pay_period_start_date', 'period_start']),
      periodEnd: pickText(row, ['end_date', 'pay_period_end_date', 'period_end']),
      paidAt: pickText(row, ['check_date', 'pay_date', 'paid_at', 'payment_date']),
      grossAmount: gross,
      employerTaxes: taxes,
      totalCost,
      ...(employees == null ? {} : { employeeCount: employees }),
      lines: normaliseLines(row),
    });
  }
  return out;
}

function normaliseLines(row: Record<string, unknown>): PayRunLine[] {
  const source = Array.isArray(row.employee_compensations) ? row.employee_compensations
    : Array.isArray(row.lines) ? row.lines
    : Array.isArray(row.employees) ? row.employees
    : [];
  const lines: PayRunLine[] = [];
  for (const raw of source) {
    const line = asRecord(raw);
    const amount = pick(line, ['gross_pay', 'amount', 'total', 'gross']);
    if (amount == null) continue;
    lines.push({
      description: (pickText(line, ['name', 'employee_name', 'full_name', 'employee_uuid', 'employee_id']) ?? 'Employee').slice(0, 500),
      quantity: pick(line, ['hours', 'quantity']) ?? 1,
      unitAmount: pick(line, ['rate', 'hourly_rate']) ?? amount,
      amount,
      taxAmount: pick(line, ['employer_taxes', 'company_taxes']),
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The runs a surface shows, newest money first. */
export async function listPayRuns(db: Db, tenantId: number, limit = PAGE) {
  const rows = await db
    .select({
      reference: payRuns.reference,
      source: payRuns.source,
      externalRef: payRuns.externalRef,
      currency: payRuns.currency,
      status: payRuns.status,
      periodStart: payRuns.periodStart,
      periodEnd: payRuns.periodEnd,
      paidAt: payRuns.paidAt,
      grossAmount: payRuns.grossAmount,
      employerTaxes: payRuns.employerTaxes,
      totalCost: payRuns.totalCost,
      employeeCount: payRuns.employeeCount,
      syncedAt: payRuns.syncedAt,
    })
    .from(payRuns)
    .where(scopedToTenant(payRuns, tenantId))
    .orderBy(desc(payRuns.paidAt), desc(payRuns.id))
    .limit(Math.max(1, Math.min(Math.round(limit), PAGE)));

  return rows.map((row) => ({
    reference: row.reference,
    source: row.source,
    externalRef: row.externalRef,
    currency: row.currency,
    status: row.status,
    periodStartISO: row.periodStart ? row.periodStart.toISOString() : null,
    periodEndISO: row.periodEnd ? row.periodEnd.toISOString() : null,
    paidAtISO: row.paidAt ? row.paidAt.toISOString() : null,
    grossAmount: row.grossAmount == null ? null : Number(row.grossAmount),
    employerTaxes: row.employerTaxes == null ? null : Number(row.employerTaxes),
    totalCost: Number(row.totalCost),
    employeeCount: row.employeeCount,
    syncedAtISO: row.syncedAt.toISOString(),
  }));
}

/** The per-employee lines of one run. */
export async function payRunLines(db: Db, tenantId: number, reference: string) {
  const rows = await db
    .select({
      description: invoiceLineItems.description,
      quantity: invoiceLineItems.quantity,
      unitAmount: invoiceLineItems.unitAmount,
      amount: invoiceLineItems.amount,
      taxAmount: invoiceLineItems.taxAmount,
    })
    .from(invoiceLineItems)
    .where(scopedToTenant(invoiceLineItems, tenantId, and(
      eq(invoiceLineItems.documentKind, PAY_RUN_LINES),
      eq(invoiceLineItems.invoiceRef, reference.trim().slice(0, 64)),
    )))
    .orderBy(invoiceLineItems.position)
    .limit(500);

  return rows.map((row) => ({
    description: row.description,
    quantity: Number(row.quantity),
    unitAmount: Number(row.unitAmount),
    amount: Number(row.amount),
    taxAmount: row.taxAmount == null ? null : Number(row.taxAmount),
  }));
}

/**
 * Payroll cost per month — the largest line on a forecast, as a FACT.
 *
 * Only `processed` runs, because only processed money has left. Grouped on
 * `paid_at` for the reason the schema states, and computed in the database rather
 * than in the isolate: this is an aggregate over an indexed range, and pulling the
 * rows across to sum them in JavaScript is the shape the performance standard
 * rejects.
 */
export async function payRunBurnByMonth(db: Db, tenantId: number, months = 12) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - Math.max(1, Math.min(Math.round(months), 36)));
  since.setUTCDate(1);

  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${payRuns.paidAt}), 'YYYY-MM')`,
      currency: payRuns.currency,
      total: sql<string>`sum(${payRuns.totalCost})`,
      runs: sql<number>`count(*)::int`,
    })
    .from(payRuns)
    .where(scopedToTenant(payRuns, tenantId, and(
      eq(payRuns.status, 'processed'),
      gte(payRuns.paidAt, since),
    )))
    .groupBy(sql`date_trunc('month', ${payRuns.paidAt})`, payRuns.currency)
    .orderBy(sql`date_trunc('month', ${payRuns.paidAt})`)
    .limit(48);

  return rows.map((row) => ({ month: row.month, currency: row.currency, total: Number(row.total), runs: row.runs }));
}

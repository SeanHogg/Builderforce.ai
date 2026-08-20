/**
 * `hr.hrms_sync` — the write half.
 *
 * ── IT RECONCILES INTO THE TABLE THAT ALREADY EXISTS ─────────────────────────
 * `people_employees` (PRD 20 §3, migration 0420) is where this platform keeps
 * employees, and `people.headcount` — the metric the PMO surfaces and the
 * forecast reads — is `COUNT(*)` over it. A sync that wrote into a second, private
 * roster table would leave that number describing whatever somebody typed in by
 * hand, forever, while a fully-populated shadow table sat beside it. So this
 * writes `people_employees`, and no new table was added.
 *
 * ── AND IT WRITES THE AUDIT ROW ──────────────────────────────────────────────
 * `hr_employment_records` exists for exactly this: the employee row carries
 * current state, the record carries how it got there. A hire and a termination
 * discovered by a sync are employment events like any other, so each writes one —
 * with `approved_by` naming the connector rather than a person, because that is
 * the truth about who made the change.
 *
 * ── PREVIEW FIRST IS THE DEFAULT POSTURE, NOT THE DEFAULT FLAG ───────────────
 * The plan is computed before anything is written and returned either way, so a
 * `dryRun` call and a real one produce the same object and differ only in whether
 * it was applied. The tool's description tells the model to preview a first sync;
 * the flag is honest rather than defensive.
 */

import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { hrEmploymentRecords, peopleEmployees } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { fetchLocalEmployees, fetchRoster } from './hrmsPort';
import { hrmsRefusal, type HrmsRefusal } from './roster';
import {
  planRosterReconciliation,
  type EmployeeFields,
  type ReconciliationPlan,
} from './rosterReconciliation';

export interface SyncResult {
  ok: true;
  source: string;
  connectedSources: string[];
  dryRun: boolean;
  /** True only when the provider returned the whole roster — see `rosterReconciliation`. */
  completeRead: boolean;
  created: number;
  updated: number;
  unchanged: number;
  /** Departures PROPOSED. Applied only when `markDepartures` was asked for. */
  departuresProposed: number;
  departuresApplied: number;
  duplicates: string[];
  /** Local rows another system (or a person) authored. Never touched by a sync. */
  untouchedLocalRows: number;
  /** The first rows of each bucket, so a person can see what changed. */
  preview: {
    create: Array<{ name: string; title: string | null; department: string | null }>;
    update: Array<{ name: string; changed: string[] }>;
    departed: string[];
  };
  instruction: string;
}

const PREVIEW_ROWS = 20;

const toDate = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
};

const columnsFor = (fields: EmployeeFields) => ({
  employeeCode: fields.employeeCode,
  title: fields.title,
  department: fields.department,
  managerRef: fields.managerRef,
  location: fields.location,
  employment: fields.employment,
  status: fields.status,
  startedAt: toDate(fields.startedAt),
  endedAt: toDate(fields.endedAt),
  updatedAt: new Date(),
});

/**
 * Pull the roster and reconcile it into `people_employees`.
 *
 * `markDepartures` is separate from the sync itself and defaults OFF. A
 * termination date is a fact with employment consequences and the sync's evidence
 * for it is an ABSENCE — see `rosterReconciliation.ts` on why that is the most
 * dangerous inference in the whole exchange. The proposals are always returned;
 * applying them is a second, explicit decision.
 */
export async function syncRoster(
  db: Db,
  env: Env,
  tenantId: number,
  options: { connectorKey?: string | null; dryRun?: boolean; markDepartures?: boolean } = {},
): Promise<SyncResult | HrmsRefusal> {
  const dryRun = options.dryRun === true;
  // Never from cache: a sync that wrote from a cached read would re-apply a stale
  // answer over a fresher one.
  const read = await fetchRoster(db, env, tenantId, { connectorKey: options.connectorKey, fresh: true });
  if (!read.source) return hrmsRefusal({ reason: 'no_roster_source', connectedSources: read.connectedSources });
  if (read.error) {
    return hrmsRefusal({ reason: 'provider_error', connectedSources: read.connectedSources, providerError: read.error });
  }
  if (!read.rows.length) {
    return hrmsRefusal({ reason: 'empty_roster', connectedSources: read.connectedSources });
  }

  const local = await fetchLocalEmployees(db, tenantId);
  const plan = planRosterReconciliation({
    connectorKey: read.source,
    remote: read.rows,
    local,
    completeRead: read.completeRead,
  });

  let created = 0;
  let updated = 0;
  let departuresApplied = 0;
  if (!dryRun) {
    ({ created, updated, departuresApplied } = await applyPlan(db, tenantId, read.source, plan, options.markDepartures === true));
    // The roster tools read through the cache; a sync that did not clear it would
    // be invisible to the very next question the person asks.
    await invalidateCached(env, `people:roster:${tenantId}:${options.connectorKey ?? null}`);
  }

  return {
    ok: true,
    source: read.source,
    connectedSources: read.connectedSources,
    dryRun,
    completeRead: read.completeRead,
    created,
    updated,
    unchanged: plan.unchanged,
    departuresProposed: plan.departed.length,
    departuresApplied,
    duplicates: plan.duplicates,
    untouchedLocalRows: plan.foreign,
    preview: {
      create: plan.create.slice(0, PREVIEW_ROWS).map((row) => ({
        name: row.name, title: row.fields.title, department: row.fields.department,
      })),
      update: plan.update.slice(0, PREVIEW_ROWS).map((row) => ({
        name: row.name, changed: row.changes.map((c) => `${String(c.field)}: ${String(c.from ?? '—')} → ${String(c.to ?? '—')}`),
      })),
      departed: plan.departed.slice(0, PREVIEW_ROWS).map((row) => row.partyRef),
    },
    instruction: dryRun
      ? 'Nothing was written. Show the counts and the preview rows, and ask the person to confirm before running it again without dryRun. '
        + 'If `completeRead` is false the provider returned a page rather than the whole roster, so `departuresProposed` is 0 by design — say so.'
      : `Report what changed against ${read.source} by name, not just as counts. `
        + (plan.departed.length && !options.markDepartures
          ? `${plan.departed.length} local employee(s) were absent from this read and are PROPOSED as departures — they were NOT marked. `
            + 'Absence is not evidence somebody left; confirm each one with the person before re-running with markDepartures. '
          : '')
        + `${plan.foreign} local employee row(s) came from somewhere else and were left alone, which is correct — a sync owns only the rows it authored.`,
  };
}

/** Apply the plan. Split out so the decision half stays a pure function. */
async function applyPlan(
  db: Db,
  tenantId: number,
  connectorKey: string,
  plan: ReconciliationPlan,
  markDepartures: boolean,
): Promise<{ created: number; updated: number; departuresApplied: number }> {
  let created = 0;
  for (const row of plan.create) {
    const inserted = await db
      .insert(peopleEmployees)
      .values({ tenantId, partyRef: row.partyRef, ...columnsFor(row.fields) })
      // Two syncs racing on the same tenant would otherwise fail the unique index
      // and abort the run partway through, leaving the roster half-imported.
      .onConflictDoNothing({ target: [peopleEmployees.tenantId, peopleEmployees.partyRef] })
      .returning({ id: peopleEmployees.id });
    const id = inserted[0]?.id;
    if (id == null) continue;
    created += 1;
    await db.insert(hrEmploymentRecords).values({
      tenantId,
      employeeId: id,
      kind: 'hire',
      effectiveAt: toDate(row.fields.startedAt) ?? new Date(),
      next: row.fields as unknown as Record<string, unknown>,
      reason: `Discovered by an ${connectorKey} roster sync.`,
      approvedBy: `connector:${connectorKey}`,
    });
  }

  let updated = 0;
  for (const row of plan.update) {
    await db
      .update(peopleEmployees)
      .set(columnsFor(row.fields))
      .where(scopedToTenant(peopleEmployees, tenantId, eq(peopleEmployees.id, row.id)));
    updated += 1;
    // Only a state change earns an employment record. A title correction is not
    // an employment event, and writing one for every field edit turns the audit
    // trail into noise that nobody reads.
    const statusChange = row.changes.find((c) => c.field === 'status');
    if (statusChange) {
      await db.insert(hrEmploymentRecords).values({
        tenantId,
        employeeId: row.id,
        kind: row.fields.status === 'terminated' ? 'termination' : 'leave',
        effectiveAt: toDate(row.fields.endedAt) ?? new Date(),
        previous: { status: statusChange.from },
        next: { status: statusChange.to },
        reason: `${connectorKey} reported the change.`,
        approvedBy: `connector:${connectorKey}`,
      });
    }
  }

  let departuresApplied = 0;
  if (markDepartures && plan.departed.length) {
    const ids = plan.departed.map((row) => row.id);
    await db
      .update(peopleEmployees)
      .set({ status: 'terminated', endedAt: new Date(), updatedAt: new Date() })
      .where(scopedToTenant(peopleEmployees, tenantId, inArray(peopleEmployees.id, ids)));
    departuresApplied = ids.length;
    for (const row of plan.departed) {
      await db.insert(hrEmploymentRecords).values({
        tenantId,
        employeeId: row.id,
        kind: 'termination',
        effectiveAt: new Date(),
        next: { status: 'terminated' },
        reason: row.reason,
        approvedBy: `connector:${connectorKey}`,
      });
    }
  }

  return { created, updated, departuresApplied };
}

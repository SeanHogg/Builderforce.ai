/**
 * The PORT — the only module in People that reaches a provider or a table.
 *
 * Everything under `people/` except this file and `hrmsSync.ts` is pure. That
 * boundary is what makes the analytics testable against a fixture, and it is also
 * what makes "which system said so" answerable on every figure the five tools
 * return: provenance is decided here, once, and travels as `source`.
 *
 * ── FIRST CONNECTED PROVIDER ANSWERS ─────────────────────────────────────────
 * Same rule `finance/payRuns.ts` settled on, for the same reason. A workspace with
 * both Workday and Gusto has two rosters that disagree at the edges — a person on
 * unpaid leave is in one and not the other — and merging them would present two
 * different ideas of "an employee" as one number. So the first source in the
 * declared order that is connected answers, the caller is TOLD which, and every
 * other connected source is listed in `connectedSources` so a workspace that
 * wants the other one can say so.
 *
 * ── READ-THROUGH CACHED, BECAUSE A CHAT TURN IS NOT ONE CALL ─────────────────
 * `hr.org_review` then `hr.team_health` then `hr.headcount_plan` in one
 * conversation is three roster reads of the same unchanged roster, against an API
 * that is rate-limited and, for two of the six vendors, slow. The roster reads go
 * through the platform's read-through cache (`getOrSetCached`) on a short TTL.
 * {@link syncRoster} deliberately does NOT: a sync that writes from a cached read
 * would re-apply a stale answer over a fresher one.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  compensationStructures,
  openPositions,
  peopleEmployees,
  peopleObjectiveOutcomes,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { connectedConnectorKeys } from '../connectors/connectorTools';
import type { ReviewOutcome } from './performanceReview';
import type { LocalEmployee } from './rosterReconciliation';
import {
  COMPENSATION_SOURCES,
  REQUISITION_SOURCES,
  ROSTER_SOURCES,
  isoDate,
  normaliseCompensation,
  normaliseRequisitions,
  normaliseRoster,
  type CompensationBand,
  type CompensationRecord,
  type ConnectorSource,
  type Requisition,
  type RosterPerson,
} from './roster';

/** One provider read, with its provenance and its failure attached. */
export interface PortRead<T> {
  /** The connector key that answered, or null when none could be asked. */
  source: string | null;
  /** Every connector in this category the workspace has connected. */
  connectedSources: string[];
  rows: T[];
  error: string | null;
  /** True when the provider returned the whole set rather than a page of it. */
  completeRead: boolean;
}

/** Page size asked of every provider. Bounded — these are read into a model's
 *  context, and a 4,000-person roster is not a tool result. */
export const ROSTER_PAGE = 500;

/**
 * Ask the first connected source in `sources` for its rows.
 *
 * One implementation for all three reads (roster, compensation, requisitions):
 * the only thing that differs between them is the source list, the input and the
 * normaliser, and writing the discovery-call-normalise sequence three times is
 * how one of the three ends up not reporting a provider error.
 */
async function readFromFirstConnected<T>(args: {
  db: Db;
  env: Env;
  tenantId: number;
  sources: readonly ConnectorSource[];
  input: Record<string, unknown>;
  normalise: (data: unknown, connectorKey: string) => T[];
  connectorKey?: string | null;
}): Promise<PortRead<T>> {
  const connected = new Set(await connectedConnectorKeys(args.db, args.tenantId, args.env));
  const available = args.sources.filter((s) => connected.has(s.connectorKey));
  const connectedSources = available.map((s) => s.connectorKey);
  const target = args.connectorKey
    ? available.find((s) => s.connectorKey === args.connectorKey)
    : available[0];
  if (!target) return { source: null, connectedSources, rows: [], error: null, completeRead: false };

  let call;
  try {
    call = await executeConnectorAction({
      db: args.db,
      env: args.env,
      tenantId: args.tenantId,
      connectorKey: target.connectorKey,
      actionKey: target.actionKey,
      input: args.input,
      actorKind: 'agent',
    });
  } catch (error) {
    return {
      source: target.connectorKey,
      connectedSources,
      rows: [],
      error: error instanceof Error ? error.message : 'The provider could not be reached.',
      completeRead: false,
    };
  }
  if (!call.ok) {
    return {
      source: target.connectorKey,
      connectedSources,
      rows: [],
      error: call.error ?? `${target.label} answered ${call.status}.`,
      completeRead: false,
    };
  }
  const rows = args.normalise(call.data, target.connectorKey);
  return {
    source: target.connectorKey,
    connectedSources,
    rows,
    error: null,
    // A page that came back FULL is a page, not the whole set. Getting this wrong
    // in the optimistic direction is what terminates half a company — see the
    // header of `rosterReconciliation.ts`.
    completeRead: !call.truncated && rows.length < ROSTER_PAGE,
  };
}

const rosterCacheKey = (tenantId: number, connectorKey: string | null) =>
  `people:roster:${tenantId}:${connectorKey ?? 'auto'}`;
const compCacheKey = (tenantId: number) => `people:compensation:${tenantId}`;
const reqCacheKey = (tenantId: number) => `people:requisitions:${tenantId}`;

/** Short enough that a sync run minutes ago is visible, long enough that three
 *  tools in one conversation cost one upstream call. */
const READ_TTL = { kvTtlSeconds: 300, l1TtlMs: 60_000 };

/** The roster, from whichever HRIS / payroll / directory is connected. */
export async function fetchRoster(
  db: Db,
  env: Env,
  tenantId: number,
  options: { connectorKey?: string | null; fresh?: boolean } = {},
): Promise<PortRead<RosterPerson>> {
  const load = () => readFromFirstConnected<RosterPerson>({
    db,
    env,
    tenantId,
    sources: ROSTER_SOURCES,
    // Every roster manifest accepts a page size under one of these names, and an
    // action ignores parameters it does not declare — so one input serves all ten
    // rather than a per-vendor branch.
    input: { per_page: ROSTER_PAGE, limit: ROSTER_PAGE, count: ROSTER_PAGE, $top: ROSTER_PAGE, showInactive: true },
    normalise: (data) => normaliseRoster(data),
    connectorKey: options.connectorKey ?? null,
  });
  if (options.fresh) return load();
  return getOrSetCached(env, rosterCacheKey(tenantId, options.connectorKey ?? null), load, READ_TTL);
}

/** Per-person compensation, from the payroll side. */
export async function fetchCompensation(db: Db, env: Env, tenantId: number): Promise<PortRead<CompensationRecord>> {
  return getOrSetCached(env, compCacheKey(tenantId), () => readFromFirstConnected<CompensationRecord>({
    db,
    env,
    tenantId,
    sources: COMPENSATION_SOURCES,
    input: { limit: ROSTER_PAGE, page: 1 },
    normalise: (data) => normaliseCompensation(data),
  }), READ_TTL);
}

/**
 * Open requisitions — from the ATS if one is connected, and from this
 * workspace's own `open_positions` rows either way.
 *
 * Both, not one: a company routinely has approved requisitions that nobody has
 * published to an ATS yet, and a headcount plan that omits them under-reports the
 * cost of the plan it is being asked about. Each row carries which system it came
 * from, so the two are distinguishable rather than merged.
 */
export async function fetchRequisitions(db: Db, env: Env, tenantId: number): Promise<PortRead<Requisition>> {
  const connector = await getOrSetCached(env, reqCacheKey(tenantId), () => readFromFirstConnected<Requisition>({
    db,
    env,
    tenantId,
    sources: REQUISITION_SOURCES,
    input: { state: 'published', limit: 200 },
    normalise: (data, connectorKey) => normaliseRequisitions(data, connectorKey),
  }), READ_TTL);

  const local = await db
    .select({
      id: openPositions.id,
      reqTitle: openPositions.reqTitle,
      status: openPositions.status,
      openedOn: openPositions.openedOn,
      notes: openPositions.notes,
    })
    .from(openPositions)
    .where(scopedToTenant(openPositions, tenantId, eq(openPositions.status, 'open')))
    .limit(200);

  const platformRows: Requisition[] = local.map((row) => ({
    externalId: `platform:${row.id}`,
    title: row.reqTitle,
    // `open_positions` carries a team id rather than a department name; the notes
    // are the only free text on it, and inventing a department here would put a
    // fabricated grouping into a costed plan. Null is the honest value.
    department: null,
    location: null,
    status: row.status,
    openedAt: row.openedOn ? String(row.openedOn).slice(0, 10) : null,
    source: 'platform',
  }));

  return {
    source: connector.source ?? (platformRows.length ? 'platform' : null),
    connectedSources: connector.connectedSources,
    rows: [...connector.rows, ...platformRows],
    error: connector.error,
    completeRead: connector.completeRead,
  };
}

/** This workspace's published compensation bands. */
export async function fetchBands(db: Db, tenantId: number): Promise<CompensationBand[]> {
  const rows = await db
    .select({
      roleFamily: compensationStructures.roleFamily,
      level: compensationStructures.level,
      location: compensationStructures.location,
      currency: compensationStructures.currency,
      baseMin: compensationStructures.baseMin,
      baseMid: compensationStructures.baseMid,
      baseMax: compensationStructures.baseMax,
      bonusPercent: compensationStructures.bonusPercent,
    })
    .from(compensationStructures)
    .where(scopedToTenant(compensationStructures, tenantId))
    .limit(500);

  // `numeric` comes back as a string. Money becomes minor units at this edge, so
  // nothing above it does floating-point arithmetic on a salary.
  const cents = (value: string | null): number | null =>
    value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100);

  return rows.map((row) => ({
    roleFamily: row.roleFamily,
    level: row.level,
    location: row.location,
    currency: row.currency,
    baseMinCents: cents(row.baseMin),
    baseMidCents: cents(row.baseMid),
    baseMaxCents: cents(row.baseMax),
    bonusPercent: row.bonusPercent == null ? null : Number(row.bonusPercent),
  }));
}

/** The employees this workspace has stored, in the shape a reconciliation reads. */
export async function fetchLocalEmployees(db: Db, tenantId: number): Promise<LocalEmployee[]> {
  const rows = await db
    .select({
      id: peopleEmployees.id,
      partyRef: peopleEmployees.partyRef,
      employeeCode: peopleEmployees.employeeCode,
      title: peopleEmployees.title,
      department: peopleEmployees.department,
      managerRef: peopleEmployees.managerRef,
      location: peopleEmployees.location,
      employment: peopleEmployees.employment,
      status: peopleEmployees.status,
      startedAt: peopleEmployees.startedAt,
      endedAt: peopleEmployees.endedAt,
    })
    .from(peopleEmployees)
    .where(scopedToTenant(peopleEmployees, tenantId))
    .limit(5000);

  return rows.map((row) => ({
    id: row.id,
    partyRef: row.partyRef,
    employeeCode: row.employeeCode,
    title: row.title,
    department: row.department,
    managerRef: row.managerRef,
    location: row.location,
    employment: row.employment as LocalEmployee['employment'],
    status: row.status as LocalEmployee['status'],
    startedAt: row.startedAt ? row.startedAt.toISOString().slice(0, 10) : null,
    endedAt: row.endedAt ? row.endedAt.toISOString().slice(0, 10) : null,
  }));
}

/**
 * The review outcomes for one period, keyed back to the roster's external id.
 *
 * `people_objective_outcomes.employee_id` points at a local `people_employees`
 * row, and the roster is keyed by the PROVIDER's id — so the join runs through
 * `people_employees.employee_code`, which {@link syncRoster} writes with exactly
 * that value. A workspace whose employees were entered by hand rather than synced
 * has no employee code, and those outcomes correctly find no roster row: they
 * belong to people the provider does not know about.
 */
export async function fetchReviewOutcomes(db: Db, tenantId: number, period: string): Promise<ReviewOutcome[]> {
  const employees = await db
    .select({ id: peopleEmployees.id, employeeCode: peopleEmployees.employeeCode })
    .from(peopleEmployees)
    .where(scopedToTenant(peopleEmployees, tenantId))
    .limit(5000);
  const codeById = new Map(employees.filter((e) => e.employeeCode).map((e) => [e.id, e.employeeCode!]));
  if (codeById.size === 0) return [];

  const rows = await db
    .select({
      employeeId: peopleObjectiveOutcomes.employeeId,
      period: peopleObjectiveOutcomes.period,
      rating: peopleObjectiveOutcomes.rating,
      narrative: peopleObjectiveOutcomes.narrative,
      calibratedBy: peopleObjectiveOutcomes.calibratedBy,
      finalisedAt: peopleObjectiveOutcomes.finalisedAt,
    })
    .from(peopleObjectiveOutcomes)
    .where(and(
      scopedToTenant(peopleObjectiveOutcomes, tenantId, eq(peopleObjectiveOutcomes.period, period)),
      inArray(peopleObjectiveOutcomes.employeeId, [...codeById.keys()]),
    )!)
    .limit(5000);

  return rows.flatMap((row) => {
    const code = row.employeeId == null ? null : codeById.get(row.employeeId);
    if (!code) return [];
    return [{
      employeeExternalId: code,
      period: row.period,
      rating: row.rating == null ? null : Number(row.rating),
      narrative: row.narrative,
      calibratedBy: row.calibratedBy,
      finalisedAt: row.finalisedAt ? row.finalisedAt.toISOString() : null,
    }];
  });
}

/** Re-exported so the sync can normalise a date the same way every read does. */
export { isoDate };

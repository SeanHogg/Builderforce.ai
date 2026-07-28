import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * runManagerSweep — the always-on driver that runs the AI Manager pass for every
 * managed project, every tick. This is what "keeps the agents and team members
 * moving": the mechanical autonomous sweep only dispatches already-owned work in
 * arrival order, whereas this sweep grooms value, ranks by priority, assigns
 * unowned work, and merges/closes PRs — the manager judgement a human PM would do.
 *
 * Scope: a project qualifies when it has a board AND either an explicit manager
 * config row or at least one non-terminal ticket (so idle/empty projects are
 * skipped). The per-project {@link runManagerForProject} still resolves the
 * effective policy (a disabled project no-ops), so this is a cheap superset filter.
 *
 * Token gate: a tenant with no budget is skipped (the AI scoring + dispatch would
 * fail the gateway anyway) — the same gate the autonomous executor + gateway use.
 * Best-effort + isolated: one bad tenant/project can't abort the sweep.
 */
import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { buildRuntimeService } from '../../buildRuntimeService';
import { tasks, projects, boards, projectManagerConfigs } from '../../infrastructure/database/schema';
import { TaskStatus, NON_TERMINAL_TASK_STATUSES } from '../../domain/shared/types';
import { getTenantTokenAvailability } from '../llm/tenantTokenAvailability';
import { runManagerForProject } from './ManagerService';
import { createTickDispatchBudget, type TickDispatchBudget } from '../runtime/tickDispatchBudget';
import type { Env } from '../../env';


/** Bound one tick's work; a large fleet of projects paces across ticks. */
export const MAX_PROJECTS_PER_TICK = 200;

export interface ManagerSweepResult {
  projects: number;
  managed: number;
  scored: number;
  ranked: number;
  /** Previously-undated tickets placed on the timeline this tick (0364). */
  scheduled: number;
  assigned: number;
  prsConducted: number;
  prsMerged: number;
  dispatched: number;
  /** Flagged tickets whose missing role/reviewer the manager actually staffed. */
  remediated: number;
  /** Flagged tickets left for a later tick because a project hit its per-pass cap. */
  remediationDeferred: number;
  /** Tickets diagnosed as STALLED across the sweep (0367 stall triage). */
  stalled: number;
  /** Stalled tickets the manager applied its own remedy to. */
  unstuck: number;
  /** Stalled tickets handed to a human because the manager's remedy stopped working. */
  escalated: number;
  /** Previously-stalled tickets that started moving again. */
  stallsResolved: number;
  /** Orphaned "backlog management pass" cards closed by the per-pass reaper. */
  staleRunTasksClosed: number;
  /** Stalled tickets across every swept project — the full census, not the diagnosed sample. */
  censusStalled: number;
  /** Systemic findings raised (a stall cohort judged a platform defect, 0373). */
  systemicFindings: number;
  /** Platform-fix tickets those findings opened. */
  systemicTicketsCreated: number;
  tokenBlockedTenants: number;
}

interface ManagedProject { projectId: number; tenantId: number; }

/** Projects with a board that carry live work or an explicit manager config. */
export async function loadManagedProjects(db: Db, limit: number): Promise<ManagedProject[]> {
  const hasWork = exists(
    db.select({ one: sql`1` }).from(tasks)
      .where(and(eq(tasks.projectId, projects.id), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL_TASK_STATUSES))),
  );
  const hasConfig = exists(
    db.select({ one: sql`1` }).from(projectManagerConfigs)
      .where(eq(projectManagerConfigs.projectId, projects.id)),
  );
  const hasBoard = exists(
    db.select({ one: sql`1` }).from(boards).where(eq(boards.projectId, projects.id)),
  );

  const rows = await db
    .select({ projectId: projects.id, tenantId: projects.tenantId })
    .from(projects)
    .where(and(hasBoard, sql`(${hasWork} OR ${hasConfig})`))
    .limit(limit);
  return rows;
}

export async function runManagerSweep(
  env: Env,
  /** Shared per-tick dispatch ceiling (see tickDispatchBudget). The manager pass and
   *  the autonomous executor both start billable runs in the SAME cron tick, so they
   *  must draw from one tenant budget rather than each granting a private 25. */
  budget: TickDispatchBudget = createTickDispatchBudget(),
): Promise<ManagerSweepResult> {
  const db = buildDatabase(env);
  const runtimeService = buildRuntimeService(env, db);

  const managed = await loadManagedProjects(db, MAX_PROJECTS_PER_TICK);

  const result: ManagerSweepResult = {
    projects: managed.length, managed: 0, scored: 0, ranked: 0, scheduled: 0, assigned: 0,
    prsConducted: 0, prsMerged: 0, dispatched: 0, remediated: 0, remediationDeferred: 0,
    stalled: 0, unstuck: 0, escalated: 0, stallsResolved: 0, staleRunTasksClosed: 0,
    censusStalled: 0, systemicFindings: 0, systemicTicketsCreated: 0,
    tokenBlockedTenants: 0,
  };

  // Cache the per-tenant token verdict so N projects under one tenant cost one scan.
  const tokenOk = new Map<number, boolean>();

  for (const p of managed) {
    try {
      let ok = tokenOk.get(p.tenantId);
      if (ok === undefined) {
        let availability;
        try { availability = await getTenantTokenAvailability(db, p.tenantId, undefined, env); } catch { availability = null; }
        ok = !availability || availability.hasTokens; // fail OPEN on an unknown
        tokenOk.set(p.tenantId, ok);
        if (!ok) result.tokenBlockedTenants += 1;
      }
      if (!ok) continue;

      // A tenant that already spent its tick budget in the autonomous executor gets
      // no further manager-initiated runs until the next tick. Checked per project
      // because one tenant can own many managed projects.
      if (!budget.hasRoom(p.tenantId)) continue;

      const s = await runManagerForProject(env, db, runtimeService, {
        tenantId: p.tenantId, projectId: p.projectId, submittedBy: 'system:manager-cron',
      });
      if (s.skipped) continue;
      result.managed += 1;
      result.scored += s.scored;
      result.ranked += s.ranked;
      result.scheduled += s.scheduled;
      result.assigned += s.assigned;
      result.prsConducted += s.prsConducted;
      result.prsMerged += s.prsMerged;
      result.dispatched += s.dispatched;
      // Reserve what this project actually started, so the next project under the
      // same tenant — and the next sweep in this tick — sees the spend.
      for (let i = 0; i < s.dispatched; i++) budget.tryReserve(p.tenantId);
      result.remediated += s.remediated;
      result.remediationDeferred += s.remediationDeferred;
      result.stalled += s.stalled;
      result.unstuck += s.unstuck;
      result.escalated += s.escalated;
      result.stallsResolved += s.stallsResolved;
      result.staleRunTasksClosed += s.staleRunTasksClosed;
      result.censusStalled += s.censusStalled;
      result.systemicFindings += s.systemicFindings;
      result.systemicTicketsCreated += s.systemicTicketsCreated;
    } catch (err) {
      reportCaughtError(err, { source: "application/manager/runManagerSweep.ts", operation: "runManagerSweep", context: { logMessage: `[cron:manager] project=${p.projectId} tenant=${p.tenantId} failed`, details: err } });
    }
  }

  return result;
}

/**
 * prConductSweep — PR CONDUCT as its OWN registry sweep, beside `prMergeSweep`.
 *
 * CONDUCT is the half of PR management that is about a TICKET: a finished-but-parked
 * review ticket is evaluated (`decideTicketReadiness`), then returned to implementation,
 * asked for its outstanding sign-offs, or completed (opening its pull request through the
 * shared finalize path). MERGING — the half about a PULL REQUEST — has been `prMergeSweep`
 * since the measurement that showed it was 93% of a manager pass. Conduct was the last PR
 * work left inside the judgement pass; each ticket does provider round-trips (finalize,
 * sign-off dispatch), so it had the same shape of problem and now has the same fix: its own
 * budget, so the manager pass cannot be starved by review volume BY CONSTRUCTION.
 *
 * ── HOW TRIAGE STAYS OUT OF ITS WAY ──────────────────────────────────────────────────
 * The pass used to hand triage an in-memory `conductedTaskIds` set so it would not re-apply
 * a remedy on top of the one conduct had just applied. Across two sweeps there is no shared
 * memory, so the rule is derived from durable state instead: a review ticket with no live
 * run that the sweep EXAMINED recently (it stamps `conduct_seen`, see `conductMarker.ts`) is
 * conduct's (`isConductedBySweep`, triageStage.ts). A ticket the sweep did not reach — control
 * off, manager disabled, tenant budget spent, beyond the per-tick cap — keeps triage's remedy.
 * The capped reads rotate on an id cursor (`conductRotation.ts`) so none is starved.
 *
 * ── THE OPT-IN IS UNCHANGED ──────────────────────────────────────────────────────────
 * Conduct is manager AUTHORITY: the sweep selects projects with an ENABLED
 * `project_manager_configs` row of their own and at least one review ticket, and
 * `policy.prMergePolicy === 'queue'` still means nothing is conducted at all.
 */
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { buildRuntimeService } from '../../buildRuntimeService';
import { projectManagerConfigs, tasks } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { notSystemTask } from '../task/taskScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getEffectiveManagerPolicy } from '../manager/managerPolicyStore';
import { createPassBudget, type PassBudget } from '../manager/passBudget';
import type { EffectiveManagerPolicy } from '../manager/managerPolicy';
import { runBoundedPool } from '../runtime/boundedPool';
import {
  createTickDispatchBudget, tenantDispatchReserver,
  type DispatchReserver, type TickDispatchBudget,
} from '../runtime/tickDispatchBudget';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { Env } from '../../env';
import { MAX_CONCURRENT_PROJECT_QUEUES, MAX_PROJECTS_PER_TICK } from './prMergeSweep';
import {
  CONDUCT_PROJECT_CURSOR_KEY, conductTicketCursorKey, loadRotationCursor, saveRotationCursor, takeRotatingWindow,
} from './conductRotation';
import { conductReviewTicket, loadConductCohort, type ConductTally, type ReviewTicket } from './prConductTicket';

/** Review tickets one project may conduct per tick; the rest are reached on later ticks. */
export const MAX_PR_ACTIONS_PER_RUN = 20;

/** Wall-clock ONE project's conduct batch may spend before the rest waits for the next tick. */
export const PR_CONDUCT_PROJECT_BUDGET_MS = 10_000;

/** Wall-clock after which the sweep stops STARTING new projects (checked between projects). */
export const PR_CONDUCT_SWEEP_BUDGET_MS = 45_000;

export interface PrConductProjectResult extends ConductTally {
  considered: number;
  /** True when the project budget stopped the batch before every ticket was examined. */
  truncated: boolean;
}

export interface PrConductSweepResult {
  projects: number;
  worked: number;
  considered: number;
  conducted: number;
  dispatched: number;
  notReached: number;
}

interface ConductProject { projectId: number; tenantId: number; }

/**
 * Projects with an ENABLED manager config of their own AND at least one review ticket, in
 * a ROTATION by `projects.id`: those after `cursor` first, then wrapping. NOT oldest-first —
 * conducting a ticket usually leaves `updated_at` alone, so an age order pinned the same
 * projects at the head of the window forever (see `conductRotation.ts`).
 */
export async function loadConductProjects(db: Db, limit: number, cursor = 0): Promise<ConductProject[]> {
  const rows = await takeRotatingWindow({
    cursor, limit,
    fetch: (range, n) => db
      .select({ projectId: tasks.projectId, tenantId: tasks.tenantId })
      .from(tasks)
      .innerJoin(projectManagerConfigs, and(
        eq(projectManagerConfigs.projectId, tasks.projectId),
        eq(projectManagerConfigs.tenantId, tasks.tenantId),
        eq(projectManagerConfigs.enabled, true),
      ))
      .where(and(
        eq(tasks.status, TaskStatus.IN_REVIEW), eq(tasks.archived, false), notSystemTask,
        'after' in range ? gt(tasks.projectId, range.after) : lte(tasks.projectId, range.upTo),
      ))
      .groupBy(tasks.projectId, tasks.tenantId)
      .orderBy(asc(tasks.projectId))
      .limit(n),
  });
  // `tasks.tenant_id` is nullable in the schema; the join on the manager config's tenant already excludes null rows.
  return rows.flatMap((r) => (r.projectId == null || r.tenantId == null ? [] : [{ projectId: r.projectId, tenantId: r.tenantId }]));
}

/** The project's review tickets in id rotation after `cursor`, bounded to one tick's share. */
export async function loadReviewTickets(
  db: Db, tenantId: number, projectId: number, cursor = 0,
): Promise<ReviewTicket[]> {
  return takeRotatingWindow({
    cursor, limit: MAX_PR_ACTIONS_PER_RUN,
    fetch: (range, n) => db
      .select({
        id: tasks.id, title: tasks.title, status: tasks.status, gitBranch: tasks.gitBranch,
        githubPrUrl: tasks.githubPrUrl, assignedAgentRef: tasks.assignedAgentRef,
        assignedAgentHostId: tasks.assignedAgentHostId, taskType: tasks.taskType, actionType: tasks.actionType,
      })
      .from(tasks)
      .where(and(
        eq(tasks.tenantId, tenantId), eq(tasks.projectId, projectId),
        eq(tasks.status, TaskStatus.IN_REVIEW), eq(tasks.archived, false), notSystemTask,
        'after' in range ? gt(tasks.id, range.after) : lte(tasks.id, range.upTo),
      ))
      .orderBy(asc(tasks.id))
      .limit(n),
  });
}

/**
 * Conduct ONE project's review tickets within its own budget. Exported so the operator
 * force-run and the tests can drive a single project without project selection.
 */
export async function runPrConductForProject(
  env: Env, db: Db, runtimeService: RuntimeService,
  ctx: {
    tenantId: number; projectId: number; policy: EffectiveManagerPolicy;
    /** The tenant's shared per-tick RUN ceiling. Every billable start reserves first. */
    runs: DispatchReserver;
    budget?: PassBudget;
  },
): Promise<PrConductProjectResult> {
  const { tenantId, projectId, policy, runs } = ctx;
  const budget = ctx.budget ?? createPassBudget(Date.now(), PR_CONDUCT_PROJECT_BUDGET_MS, 0);
  const result: PrConductProjectResult = { conducted: 0, dispatched: 0, considered: 0, truncated: false };
  if (policy.prMergePolicy === 'queue') return result;

  const cursorKey = conductTicketCursorKey(tenantId, projectId);
  const tickets = await loadReviewTickets(db, tenantId, projectId, await loadRotationCursor(env, cursorKey));
  result.considered = tickets.length;
  if (!tickets.length) return result;
  const cohort = await loadConductCohort(env, db, runtimeService, { tenantId, projectId, policy, tickets });
  // No manager "backlog management pass" card owns this work, so its journal rows are unparented.
  const ticketCtx = { tenantId, projectId, policy, runs, runTaskId: null, cohort, out: result };
  let lastExamined: number | null = null;
  for (const t of tickets) {
    // BETWEEN tickets, never mid-ticket: an action already begun always completes, so
    // shedding work can never leave a half-applied action.
    if (budget.over()) { budget.shed('pr_conduct'); break; }
    await conductReviewTicket(env, db, runtimeService, ticketCtx, t);
    lastExamined = t.id;
  }
  // The next tick resumes AFTER the last ticket examined, so none is starved by its neighbours.
  if (lastExamined != null) await saveRotationCursor(env, cursorKey, lastExamined);
  result.truncated = budget.truncated.includes('pr_conduct');
  return result;
}

/** The registered sweep: conduct every opted-in project's review tickets, bounded by {@link PR_CONDUCT_SWEEP_BUDGET_MS}. */
export async function runPrConductSweep(
  env: Env,
  /** Shared per-tick dispatch ceiling — sign-off asks and restarts are billable runs. */
  budget: TickDispatchBudget = createTickDispatchBudget(),
): Promise<PrConductSweepResult> {
  const db = buildDatabase(env);
  const runtimeService = buildRuntimeService(env, db);
  const projects = await loadConductProjects(db, MAX_PROJECTS_PER_TICK, await loadRotationCursor(env, CONDUCT_PROJECT_CURSOR_KEY));
  const result: PrConductSweepResult = { projects: projects.length, worked: 0, considered: 0, conducted: 0, dispatched: 0, notReached: 0 };

  const startedAt = Date.now();
  const pool = await runBoundedPool(
    projects,
    { limit: MAX_CONCURRENT_PROJECT_QUEUES, deadlineAt: startedAt + PR_CONDUCT_SWEEP_BUDGET_MS },
    async (p) => {
      try {
        if (!budget.hasRoom(p.tenantId)) return;
        const policy = await getEffectiveManagerPolicy(db, p.tenantId, p.projectId, env);
        if (!policy.enabled) return;
        const one = await runPrConductForProject(env, db, runtimeService, {
          tenantId: p.tenantId, projectId: p.projectId, policy,
          runs: tenantDispatchReserver(budget, p.tenantId),
        });
        result.worked += 1;
        result.considered += one.considered;
        result.conducted += one.conducted;
        result.dispatched += one.dispatched;
      } catch (err) {
        reportCaughtError(err, {
          source: 'application/repos/prConductSweep.ts', operation: 'runPrConductSweep',
          context: { logMessage: `[cron:pr-conduct] project=${p.projectId} tenant=${p.tenantId} failed`, details: err },
        });
      }
    },
  );
  result.notReached = pool.notReached;
  // Projects are started in order, so the last one STARTED is the resume point.
  const reached = projects[pool.started - 1];
  if (reached) await saveRotationCursor(env, CONDUCT_PROJECT_CURSOR_KEY, reached.projectId);
  return result;
}

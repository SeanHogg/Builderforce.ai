import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * runManagerSweep — the always-on driver that runs the AI Manager pass for every
 * managed project, every tick. This is what "keeps the agents and team members
 * moving": the mechanical autonomous sweep only dispatches already-owned work in
 * arrival order, whereas this sweep grooms value, ranks by priority, assigns
 * unowned work, and merges/closes PRs — the manager judgement a human PM would do.
 *
 * Scope — OPT-IN. A project qualifies when a human has configured a manager for it (an
 * enabled `project_manager_configs` row of its own), it has a board, and it has open
 * work: live tickets or open pull requests. A project that never asked for a manager is
 * not managed, however busy its board is. See {@link isProjectManaged}, which is the one
 * definition of that rule; this query is its SQL mirror and `runManagerForProject`
 * re-checks it so the manual "Run manager now" path cannot disagree with the schedule.
 *
 * Token gate: a tenant with no budget is skipped (the AI scoring + dispatch would
 * fail the gateway anyway) — the same gate the autonomous executor + gateway use.
 * Best-effort + isolated: one bad tenant/project can't abort the sweep.
 */
import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { buildRuntimeService } from '../../buildRuntimeService';
import { tasks, projects, boards, projectManagerConfigs, pullRequests } from '../../infrastructure/database/schema';
import { TaskStatus, NON_TERMINAL_TASK_STATUSES } from '../../domain/shared/types';
import { getTenantTokenAvailability } from '../llm/tenantTokenAvailability';
import { runManagerForProject } from './ManagerService';
import { createTickDispatchBudget, type TickDispatchBudget } from '../runtime/tickDispatchBudget';
import type { Env } from '../../env';


/** Bound one tick's work; a large fleet of projects paces across ticks. */
export const MAX_PROJECTS_PER_TICK = 200;

/**
 * How many project passes run AT ONCE.
 *
 * ── WHY THIS IS NOT 1 ────────────────────────────────────────────────────────────
 * It was. This sweep `await`ed {@link runManagerForProject} inside a plain `for` loop
 * over up to {@link MAX_PROJECTS_PER_TICK} projects, and one pass costs 20–31s of
 * wall-clock (measured on project 11, 2026-07-30). So the first project consumed the
 * entire invocation and every project behind it got nothing — not "less", nothing —
 * and because `loadManagedProjects` had no ORDER BY, "behind it" meant the same
 * projects on every tick, forever. A manager that manages one project out of a fleet
 * is not a scheduler, it is a queue with one server that never drains.
 *
 * A pass is almost entirely I/O — Postgres round-trips and provider API calls — so
 * concurrency here is real parallelism rather than CPU contention, which is why the
 * fix is a bounded pool and not a bigger budget. Bounded, because neon-http opens a
 * connection per query and an unbounded fan-out over 200 projects would replace a
 * starved sweep with a throttled database.
 */
export const MAX_CONCURRENT_PROJECT_PASSES = 6;

/**
 * Wall-clock after which the sweep stops STARTING new projects.
 *
 * The tick fires every 5 minutes, so a sweep that runs long is not saving anything —
 * it is risking eviction partway through a pass, which is the failure that left
 * `manager.pass` rows unwritten for two weeks. Stopping cleanly between projects is
 * free because the rotation below guarantees whatever was not reached is at the FRONT
 * of the next tick.
 */
export const MANAGER_SWEEP_BUDGET_MS = 60_000;

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
  /**
   * Projects this tick never started, because it hit {@link MANAGER_SWEEP_BUDGET_MS}.
   *
   * Reported because the previous sweep could not have reported it: it ran projects
   * serially until the Worker was evicted, so there was no moment at which it knew how
   * many it had skipped — the invocation simply ended. A non-zero value here is the
   * signal to raise {@link MAX_CONCURRENT_PROJECT_PASSES}; a value that stays near
   * `projects` means the fleet needs a pass-per-project Durable Object rather than a
   * pool inside one invocation.
   */
  notReached: number;
}

interface ManagedProject { projectId: number; tenantId: number; }

/**
 * Projects that have OPTED IN to being managed and have something to manage.
 *
 * ── THE OPT-IN (the SQL mirror of `isProjectManaged`) ────────────────────────────
 * This used to match `hasBoard AND (hasWork OR hasConfig)` — so the real rule was **any
 * project with a board and one open ticket gets an AI manager**, configured or not,
 * because a project with no config row folds to the hardcoded `enabled: true` default.
 * That is opt-OUT for a thing that ranks, assigns, reopens tickets, dispatches billable
 * runs and merges pull requests. The `project_manager_configs` row only ever comes into
 * existence through a deliberate write from the Manager settings surface, so requiring
 * it — as an INNER join, so the requirement is structural rather than a clause someone
 * can drop — makes "a human turned this on" the precondition it always should have been.
 *
 * ── AND IT IS WHAT MAKES THE ROTATION BELOW WELL-FOUNDED ─────────────────────────
 * The `last_run_at` rotation is stamped by an UPDATE, not an upsert, so a project with no
 * config row could never be stamped. Under the old LEFT join such a project sorted NULLS
 * FIRST, got managed, failed to stamp, and sorted first again — pinning the head of the
 * rotation forever and starving every project behind it. The fairness fix and the opt-in
 * are the same fix: every project the sweep can now select is one it can also stamp.
 */
export async function loadManagedProjects(db: Db, limit: number): Promise<ManagedProject[]> {
  // Something to manage. Open PRs count as work in their own right — the merge queue is
  // real work on a project whose tickets are all closed, and gating on tickets alone
  // would strand a finished board's last pull requests.
  const hasWork = exists(
    db.select({ one: sql`1` }).from(tasks)
      .where(and(eq(tasks.projectId, projects.id), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL_TASK_STATUSES))),
  );
  const hasOpenPr = exists(
    db.select({ one: sql`1` }).from(pullRequests)
      .where(and(
        eq(pullRequests.projectId, projects.id),
        eq(pullRequests.tenantId, projects.tenantId),
        eq(pullRequests.status, 'open'),
      )),
  );
  const hasBoard = exists(
    db.select({ one: sql`1` }).from(boards).where(eq(boards.projectId, projects.id)),
  );

  const rows = await db
    .select({ projectId: projects.id, tenantId: projects.tenantId })
    .from(projects)
    .innerJoin(projectManagerConfigs, and(
      eq(projectManagerConfigs.projectId, projects.id),
      // Correlated on the tenant as well as the project: `project_manager_configs` is
      // tenant-owned, and a join on `project_id` alone is the shape that leaks rows
      // across tenants the moment ids collide.
      eq(projectManagerConfigs.tenantId, projects.tenantId),
    ))
    .where(and(
      // The project's own master switch. Checked here as well as inside the pass so a
      // disabled project costs the sweep nothing at all, rather than a pass that loads
      // its policy only to return `skipped`.
      eq(projectManagerConfigs.enabled, true),
      hasBoard,
      sql`(${hasWork} OR ${hasOpenPr})`,
    ))
    // ── LONGEST-UNMANAGED FIRST ────────────────────────────────────────────────────
    // This had NO order at all, so it returned heap order — in practice the same rows
    // in the same sequence on every tick. Combined with a serial loop that ran out of
    // wall-clock after the first project, the tail was not merely deprioritised, it was
    // unreachable: a project that came second was never managed once, on any tick.
    //
    // `last_run_at` is stamped by the pass itself at the end of every run, so the
    // rotation maintains itself with no cursor and no extra storage: never-managed
    // projects (no config row → NULL) go first, then the longest-waiting. `projects.id`
    // breaks ties so the order is total and two equally-stale projects cannot oscillate.
    //
    // Fairness is the right property HERE and was the wrong one for the PR window (see
    // `prMergeQueue.ts`, which had to give up exactly this ordering). The difference is
    // that each project's pass is independent work that makes progress on its own,
    // whereas a pull request needs repeated attempts on the SAME item to converge —
    // rotating those diluted the attempts below the ceiling they had to reach.
    .orderBy(sql`${projectManagerConfigs.lastRunAt} asc nulls first`, asc(projects.id))
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
    tokenBlockedTenants: 0, notReached: 0,
  };

  // Cache the per-tenant token verdict so N projects under one tenant cost one scan.
  // The PROMISE is cached, not the value: passes now run concurrently, so caching the
  // resolved boolean would let every project of one tenant miss simultaneously and each
  // start its own scan — the N+1 this map exists to prevent, reintroduced by the
  // parallelism. Awaiting a shared promise collapses them back to one.
  const tokenOk = new Map<number, Promise<boolean>>();
  const tenantHasTokens = (tenantId: number): Promise<boolean> => {
    const cached = tokenOk.get(tenantId);
    if (cached) return cached;
    const pending = (async () => {
      let availability;
      try { availability = await getTenantTokenAvailability(db, tenantId, undefined, env); } catch { availability = null; }
      const ok = !availability || availability.hasTokens; // fail OPEN on an unknown
      if (!ok) result.tokenBlockedTenants += 1;
      return ok;
    })();
    tokenOk.set(tenantId, pending);
    return pending;
  };

  const runOne = async (p: ManagedProject) => {
    try {
      if (!await tenantHasTokens(p.tenantId)) return;

      // A tenant that already spent its tick budget in the autonomous executor gets
      // no further manager-initiated runs until the next tick. Checked per project
      // because one tenant can own many managed projects.
      if (!budget.hasRoom(p.tenantId)) return;

      const s = await runManagerForProject(env, db, runtimeService, {
        tenantId: p.tenantId, projectId: p.projectId, submittedBy: 'system:manager-cron',
        // THE CEILING, handed DOWN rather than reconciled UP. Every dispatch site inside
        // the pass reserves against this before it starts work — see the note on the
        // removed replay loop below.
        dispatchBudget: budget,
      });
      if (s.skipped) return;
      result.managed += 1;
      result.scored += s.scored;
      result.ranked += s.ranked;
      result.scheduled += s.scheduled;
      result.assigned += s.assigned;
      result.prsConducted += s.prsConducted;
      result.prsMerged += s.prsMerged;
      result.dispatched += s.dispatched;
      // NO REPLAY LOOP HERE. This used to read:
      //
      //     for (let i = 0; i < s.dispatched; i++) budget.tryReserve(p.tenantId);
      //
      // — dispatch-then-count, the exact pattern `tickDispatchBudget`'s header forbids in
      // bold. The boolean `tryReserve` returns was discarded because by then the runs had
      // already happened, so the ceiling could not refuse anything: the `hasRoom` check
      // above was an admission gate, not a reservation, and a tenant owning several
      // managed projects got a fresh one per project. Simulated, that is 43 runs against
      // a ceiling of 25 for one project and 38 across five
      // (`tickDispatchBudget.contract.test.ts`). The pass now reserves each slot before
      // starting the work it is for, so `s.dispatched` is already accounted.
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
  };

  // ── THE POOL ─────────────────────────────────────────────────────────────────────
  // N workers drawing from one cursor, rather than `for (const p of managed) await …`.
  // `cursor++` needs no lock: it is a synchronous read-modify-write, and JS cannot
  // interleave two of those — the only suspension points are the `await`s inside
  // `runOne`, by which time the slot is already claimed.
  //
  // Each worker stops on the deadline as well as on the end of the list, and it checks
  // BEFORE claiming so a project is never half-started by the clock. A project not
  // reached is not lost: it sorted to the front of the next tick the moment this one
  // declined to stamp its `last_run_at`.
  const startedAt = Date.now();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (Date.now() - startedAt >= MANAGER_SWEEP_BUDGET_MS) return;
      const next = managed[cursor++];
      if (!next) return;
      await runOne(next);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_PROJECT_PASSES, managed.length) }, worker),
  );
  // Honest accounting of what the tick did NOT get to. `projects` alone reads as
  // coverage; this is the number that says whether the fleet has outgrown the sweep.
  result.notReached = Math.max(0, managed.length - cursor);

  return result;
}

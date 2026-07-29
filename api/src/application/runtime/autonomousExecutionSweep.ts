import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * autonomousExecutionSweep — the always-on, server-side executor for the board's
 * autonomous agents.
 *
 * The board "autonomous trigger" ({@link maybeAutoRunOnLaneEntry}) fires when a
 * ticket ENTERS a lane (created / PATCHed / an agent advanced it). That covers the
 * live path, but a run whose kickoff was dropped (a `waitUntil` isolate evicted
 * before dispatch), a ticket created into a staffed lane while nothing was polling,
 * or simply a backlog of assigned work would otherwise sit "pending" forever — the
 * reported symptom (agents assigned, tickets reading "pending", nothing running).
 *
 * This sweep is the backstop that makes execution TRULY autonomous across ALL
 * tenants and ALL projects: every tick it finds agent-owned, non-terminal tickets
 * with no live run and fires the SAME canonical trigger the board uses, so an
 * eligible ticket starts within one tick no matter how it got stuck. It is the
 * cron half of "all customers' work executes in the cloud all the time".
 *
 * Token gate: a run is dispatched ONLY when the tenant still has token budget
 * (the same {@link getTenantTokenAvailability} the gateway + meter use). A tenant
 * that is out of tokens is SKIPPED — its pending agents are counted and its
 * managers get an upgrade nudge (once per UTC day) telling them how many agents are
 * waiting. Turning tokens back on (upgrade / daily reset) resumes execution on the
 * next tick with zero extra action.
 *
 * Best-effort + isolated: every per-tenant / per-ticket step is wrapped so one bad
 * tenant can't abort the sweep, and the dispatch trigger is itself idempotent
 * (dedupes on a live execution), so overlapping ticks never double-run a ticket.
 */
import { and, asc, eq, exists, inArray, isNotNull, not, or, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { buildRuntimeService } from '../../buildRuntimeService';
import { createTickDispatchBudget, MAX_TENANT_DISPATCHES_PER_TICK, tenantDispatchReserver, type TickDispatchBudget } from './tickDispatchBudget';
import { executions, tasks, projects, boards, swimlanes, swimlaneAgentAssignments } from '../../infrastructure/database/schema';
import { RuntimeService } from './RuntimeService';
import { TaskStatus } from '../../domain/shared/types';
import { getTenantTokenAvailability } from '../llm/tenantTokenAvailability';
import { sendPendingAgentsUpgradeEmail } from './pendingAgentsUpgradeEmail';
import { maybeAutoRunOnLaneEntry } from '../../presentation/routes/taskRoutes';
import type { Env } from '../../env';

/** The non-terminal statuses whose lane an agent could work — the candidate scan
 *  is bounded to these (Done/Blocked are excluded up front; the lane evaluator
 *  still has the final say per ticket). */
const RUNNABLE_STATUSES: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW,
];

/**
 * Storm guards. The sweep runs every few minutes; these bound one tick's work so a huge
 * backlog is drained across ticks instead of dispatching thousands at once.
 *
 * THE PACING ONLY WORKS IF A LIVE TICKET VACATES ITS SLOT. This bound used to be
 * justified by "each dispatched ticket becomes a live run and is skipped next tick, so
 * the backlog naturally paces itself" — but the skip happened in the EVALUATOR, one layer
 * below, while the ticket kept its place in this window. The ordering is total and stable
 * (manager rank, then priority, then `updated_at`), so with more qualifying tickets than
 * the limit the window is the SAME rows on every tick and everything below it is
 * structurally unreachable — not delayed, unreachable. It is the identical defect 0381
 * fixed one layer up for the PR loop's unordered `LIMIT 20`.
 *
 * Measured on project 11, 2026-07-29: 372 of 670 stalled tickets `never_started`, the
 * oldest idle 49 days, on a board that completed 2,151 agent runs that same day and holds
 * 708 managed tickets against this 400-row window. The board was not idle and the tickets
 * were not ineligible — they were never looked at.
 *
 * {@link loadAutonomousCandidates} now excludes tickets with a live run, which is what the
 * paragraph above always claimed: a dispatched ticket leaves the window for as long as it
 * is running, and the next-priority ticket takes the slot.
 */
export const MAX_CANDIDATES_PER_TICK = 400;

/** Re-exported for back-compat. The per-tenant ceiling now lives in
 *  {@link MAX_TENANT_DISPATCHES_PER_TICK} because it is shared with every OTHER
 *  dispatching sweep in the same cron tick rather than owned by this one. */
export const MAX_DISPATCHES_PER_TENANT_PER_TICK = MAX_TENANT_DISPATCHES_PER_TICK;

export interface AutonomousSweepResult {
  candidates: number;
  dispatched: number;
  /** Tenants skipped because they were out of tokens. */
  tokenBlockedTenants: number;
  /** Total agent-owned tickets sitting pending under token-blocked tenants. */
  pendingUnderBlockedTenants: number;
  upgradeEmailsSent: number;
}

interface CandidateTask {
  taskId: number;
  projectId: number;
  tenantId: number;
  status: string;
}

/**
 * Load the non-terminal, non-archived tickets that could auto-run, across every
 * tenant, oldest-waiting first (so the longest-stuck work goes first). A ticket
 * qualifies when EITHER:
 *   • it is agent-OWNED (`tasks.assigned_agent_ref` set) — the concrete "# of
 *     agents pending" the board shows, OR
 *   • its current-status lane is STAFFED (the swimlane matching its status has ≥1
 *     `swimlane_agent_assignments` row) — a lane agent should pick it up even
 *     though no one owns the ticket.
 * The lane evaluator ({@link maybeAutoRunOnLaneEntry}) still has the final say per
 * ticket (gate / capability / live-run), so this is a superset filter that only
 * bounds the scan.
 *
 * Split from {@link loadAutonomousCandidates} and left SYNCHRONOUS so the rendered SQL can
 * be asserted without a connection (`.toSQL()`); the defect this window carried lived
 * entirely in the WHERE clause, which no in-memory test of the sweep can see. Same reason
 * `managedTasksQuery` is split out of the manager pass.
 */
export function autonomousCandidatesQuery(db: Db, limit: number) {
  // A ticket with a run already in flight cannot be dispatched — the evaluator refuses
  // it — so it must not hold a slot in the bounded window. Rehearsals do not count
  // (`mode = 'live'`), or a dry run would park a ticket out of the window for its whole
  // duration. See {@link MAX_CANDIDATES_PER_TICK} for what leaving them in cost.
  const hasLiveRun = exists(
    db
      .select({ one: sql`1` })
      .from(executions)
      .where(and(
        eq(executions.taskId, tasks.id),
        eq(executions.mode, 'live'),
        inArray(executions.status, RuntimeService.NON_TERMINAL_STATUSES),
      )),
  );

  // Correlated EXISTS: does the ticket's project board have a swimlane whose key
  // matches the ticket's status AND that lane carries an agent assignment?
  const laneStaffed = exists(
    db
      .select({ one: sql`1` })
      .from(swimlaneAgentAssignments)
      .innerJoin(swimlanes, eq(swimlanes.id, swimlaneAgentAssignments.swimlaneId))
      .innerJoin(boards, eq(boards.id, swimlanes.boardId))
      .where(and(
        eq(boards.projectId, tasks.projectId),
        eq(swimlanes.key, tasks.status),
      )),
  );

  return db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      tenantId: projects.tenantId,
      status: tasks.status,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(tasks.archived, false),
      // Runnable lanes only — Done/Blocked are excluded here (a blocked ticket waits
      // on a dependency, not an agent); the lane evaluator gates the rest per ticket.
      inArray(tasks.status, RUNNABLE_STATUSES),
      or(isNotNull(tasks.assignedAgentRef), laneStaffed),
      // The window is a QUEUE, not a leaderboard — see MAX_CANDIDATES_PER_TICK.
      not(hasLiveRun),
    ))
    // Priority-first dispatch: the AI Manager's computed `manager_rank` (highest
    // value × urgency = rank 1) leads, then the raw priority tier, then oldest-waiting
    // as the final tiebreak. Unranked tickets (null rank) sort last so a groomed
    // backlog always runs before an ungroomed one. This is the fix for "items are not
    // ordered in priority" — the executor now drains the backlog by importance, not
    // just by arrival.
    .orderBy(
      sql`${tasks.managerRank} asc nulls last`,
      sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
      asc(tasks.updatedAt),
    )
    .limit(limit);
}

/** Run {@link autonomousCandidatesQuery}. */
export async function loadAutonomousCandidates(db: Db, limit: number): Promise<CandidateTask[]> {
  return autonomousCandidatesQuery(db, limit);
}

/** Group candidates by tenant, preserving the oldest-first order within each. */
export function groupByTenant(candidates: CandidateTask[]): Map<number, CandidateTask[]> {
  const byTenant = new Map<number, CandidateTask[]>();
  for (const c of candidates) {
    const list = byTenant.get(c.tenantId);
    if (list) list.push(c);
    else byTenant.set(c.tenantId, [c]);
  }
  return byTenant;
}

/**
 * One sweep pass. Called from the frequent cron tick in index.ts. Returns a small
 * result summary (used by the test + logged for observability).
 */
export async function runAutonomousExecutionSweep(
  env: Env,
  /** Shared per-tick ceiling. Omitted by a direct/manual call, which then gets its
   *  own private budget and behaves exactly as this sweep did standalone. */
  budget: TickDispatchBudget = createTickDispatchBudget(),
): Promise<AutonomousSweepResult> {
  const db = buildDatabase(env);
  const runtimeService = buildRuntimeService(env, db);

  const candidates = await loadAutonomousCandidates(db, MAX_CANDIDATES_PER_TICK);
  const byTenant = groupByTenant(candidates);

  const result: AutonomousSweepResult = {
    candidates: candidates.length,
    dispatched: 0,
    tokenBlockedTenants: 0,
    pendingUnderBlockedTenants: 0,
    upgradeEmailsSent: 0,
  };

  for (const [tenantId, tenantCandidates] of byTenant) {
    try {
      // Token gate — the ONLY reason to withhold autonomous execution. Fail OPEN on
      // an unknown (a usage-scan error must not silently freeze a tenant's board).
      let availability;
      try {
        availability = await getTenantTokenAvailability(db, tenantId, undefined, env);
      } catch {
        availability = null;
      }

      if (availability && !availability.hasTokens) {
        // The tenant is skipped WHOLESALE, above the trigger — so not one of its
        // tickets gets a per-ticket skip row, and each ticket's chain of custody shows
        // an unbroken silence for as long as the block lasts (measured: eleven days on
        // task 683, whose report still read "nothing is gating this ticket"). Writing a
        // row per ticket per tick would answer that at a cost of thousands of audit
        // rows a day per blocked tenant, which the DB budget cannot carry. Instead the
        // condition is modelled by `evaluateTaskAutoRun`, so the LIVE gate — the one a
        // lifecycle report reads — answers `tenant_token_limit` on demand and for free.
        result.tokenBlockedTenants += 1;
        result.pendingUnderBlockedTenants += tenantCandidates.length;
        // Nudge the tenant to upgrade — they have agents queued but no budget. Deduped
        // to once per UTC day per tenant inside the helper (KV-backed).
        try {
          const sent = await sendPendingAgentsUpgradeEmail(env, db, {
            tenantId,
            pendingAgents: tenantCandidates.length,
            reason: availability.reason,
            effectivePlan: availability.effectivePlan,
          });
          if (sent) result.upgradeEmailsSent += 1;
        } catch (err) {
          reportCaughtError(err, { source: "application/runtime/autonomousExecutionSweep.ts", operation: "runAutonomousExecutionSweep", context: { logMessage: `[cron:auto-exec] upgrade-email failed tenant=${tenantId}`, details: err } });
        }
        continue;
      }

      // Dispatch the tenant's oldest-waiting tickets, bounded per tick. Each fires the
      // canonical lane trigger, which re-evaluates gate/capability/live-run and starts
      // the run only when it genuinely should — so this is safe to call broadly.
      // Ceiling belongs to the TICK, not to this sweep — see tickDispatchBudget. Each
      // dispatching sweep used to hold its own private per-tenant counter, so the
      // manager / validator / QA sweeps could each grant a fresh 25 in the same
      // five-minute window and the aggregate was unbounded.
      //
      // Spent through the shared reserver rather than `hasRoom` + a post-hoc
      // `tryReserve`. That older shape traded correctness for a real property — no-ops
      // (already running / human-gated / no qualifying agent) are cheap and must not
      // starve genuinely-pending work — and paid for it with an overshoot of one per
      // concurrent sweep. `spend` gives both: it takes the slot BEFORE the trigger runs
      // and hands it straight back when nothing started.
      const runs = tenantDispatchReserver(budget, tenantId);
      let dispatchedForTenant = 0;
      for (const c of tenantCandidates) {
        try {
          const spend = await runs.spend(() => maybeAutoRunOnLaneEntry(env, db, runtimeService, {
            tenantId: c.tenantId,
            projectId: c.projectId,
            taskId: c.taskId,
            // A SNAPSHOT, deliberately: `c.status` is what the scan read, possibly
            // minutes and several lane moves ago. The evaluator re-reads the row and
            // gates on the lane the ticket is actually in — passing this only lets it
            // fall back when the row has since been deleted. Trusting the snapshot is
            // what let the sweep evaluate an auto-gated Implementation lane for a
            // ticket already sitting in a human-gated review lane, dispatch through
            // that gate, and drag the ticket backwards on every tick.
            status: c.status,
            submittedBy: 'system:auto-exec',
            // The verdict this loop already gated on — reused so the evaluator's own
            // token gate costs no second lookup per ticket, and so the sweep and the
            // evaluator cannot disagree about the tenant's budget within one tick.
            ...(availability ? {
              tenantTokens: {
                hasTokens: availability.hasTokens,
                reason: availability.reason,
                usageToday: availability.usageToday,
                dailyLimit: availability.dailyLimit,
                usageMonth: availability.usageMonth,
                monthlyLimit: availability.monthlyLimit,
                effectivePlan: availability.effectivePlan,
              },
            } : {}),
          }), (v) => v === true);
          // Out of tenant budget for the whole tick — no later candidate fares better.
          if (spend.refused) break;
          if (spend.result) dispatchedForTenant += 1;
        } catch (err) {
          reportCaughtError(err, { source: "application/runtime/autonomousExecutionSweep.ts", operation: "runAutonomousExecutionSweep", context: { logMessage: `[cron:auto-exec] dispatch failed tenant=${tenantId} task=${c.taskId}`, details: err } });
        }
      }
      result.dispatched += dispatchedForTenant;
    } catch (err) {
      reportCaughtError(err, { source: "application/runtime/autonomousExecutionSweep.ts", operation: "runAutonomousExecutionSweep", context: { logMessage: `[cron:auto-exec] tenant=${tenantId} failed`, details: err } });
    }
  }

  return result;
}

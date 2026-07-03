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
import { and, asc, eq, exists, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { buildRuntimeService } from '../../buildRuntimeService';
import { tasks, projects, boards, swimlanes, swimlaneAgentAssignments } from '../../infrastructure/database/schema';
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

/** Storm guards. The sweep runs every few minutes; these bound one tick's work so
 *  a huge backlog is drained across ticks instead of dispatching thousands at once
 *  (each dispatched ticket becomes a live run and is skipped next tick, so the
 *  backlog naturally paces itself). */
export const MAX_CANDIDATES_PER_TICK = 400;
export const MAX_DISPATCHES_PER_TENANT_PER_TICK = 25;

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
 */
export async function loadAutonomousCandidates(db: Db, limit: number): Promise<CandidateTask[]> {
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
export async function runAutonomousExecutionSweep(env: Env): Promise<AutonomousSweepResult> {
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
        availability = await getTenantTokenAvailability(db, tenantId);
      } catch {
        availability = null;
      }

      if (availability && !availability.hasTokens) {
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
          console.error(`[cron:auto-exec] upgrade-email failed tenant=${tenantId}`, err);
        }
        continue;
      }

      // Dispatch the tenant's oldest-waiting tickets, bounded per tick. Each fires the
      // canonical lane trigger, which re-evaluates gate/capability/live-run and starts
      // the run only when it genuinely should — so this is safe to call broadly.
      let dispatchedForTenant = 0;
      for (const c of tenantCandidates) {
        if (dispatchedForTenant >= MAX_DISPATCHES_PER_TENANT_PER_TICK) break;
        try {
          const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
            tenantId: c.tenantId,
            projectId: c.projectId,
            taskId: c.taskId,
            status: c.status,
            submittedBy: 'system:auto-exec',
          });
          // Only a ticket that actually started a run counts against the per-tenant
          // budget — no-ops (already running / human-gated / no qualifying agent) are
          // cheap and shouldn't starve genuinely-pending work.
          if (started) dispatchedForTenant += 1;
        } catch (err) {
          console.error(`[cron:auto-exec] dispatch failed tenant=${tenantId} task=${c.taskId}`, err);
        }
      }
      result.dispatched += dispatchedForTenant;
    } catch (err) {
      console.error(`[cron:auto-exec] tenant=${tenantId} failed`, err);
    }
  }

  return result;
}

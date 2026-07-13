/**
 * evaluateTaskAutoRun — the SINGLE source of truth for "should this ticket auto-run,
 * and if not, exactly why". One read-only evaluation reused by:
 *   • the autonomous trigger ({@link maybeAutoRunOnLaneEntry}) — acts on `canRunNow`,
 *   • the board triage diagnostic (`GET /api/tasks/:id/autorun-diagnostics`) — shows
 *     the reason so a stuck "pending" ticket is explainable instead of mysterious,
 *   • the manual "Run now" action (`POST /api/tasks/:id/run-now`) — uses `candidate`
 *     to dispatch AS the right agent even on a human-gated lane (an explicit human
 *     click is itself the approval).
 *
 * Keeping the lane-resolution + decision in ONE place means the trigger and the
 * diagnostic can never disagree about whether a ticket runs — the triage UI shows
 * precisely the condition the trigger evaluates.
 */
import { and, asc, eq } from 'drizzle-orm';
import { boards, swimlanes, swimlaneAgentAssignments, swimlaneRequirements, tasks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { resolveArtifacts } from '../artifact/resolveArtifacts';
import { isAgentRefRoleCapable } from '../kanban/roleCapability';
import { decideLaneAutoRun, withOwnerAgentFallback, type LaneAgentLike, type LaneAutoRunDecision } from './laneAutoRun';
import type { RuntimeService } from '../runtime/RuntimeService';
import { ExecutionStatus, TaskStatus } from '../../domain/shared/types';

/** Parse a swimlane assignment's `required_capabilities` JSON-text column. */
export function parseRequiredCapabilities(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  } catch {
    return [];
  }
}

/** Why a ticket will / will not auto-run on lane entry — the triage reason. */
export type AutoRunReason =
  | 'will_run'            // a configured/owner agent qualifies and the lane is auto-gated → autonomy fires
  | 'no_board'            // the project has no board (no lanes to resolve against)
  | 'no_lane'             // no swimlane matches the ticket's status key
  | 'terminal_lane'       // Done / terminal lane — finalized, never auto-run
  | 'human_gate'          // the lane gate is 'human' — waits for explicit approval / Run now
  | 'no_agent'            // no lane-staffed agent AND no owner agent — nothing to run as
  | 'capability_mismatch' // every candidate agent lacks the lane's required capabilities
  | 'already_running'     // a live run already exists (or a same-lane re-entry loop guard)
  | 'run_cap_exhausted'   // the ticket's last N consecutive runs all FAILED — autonomy stops re-dispatching (a human Run-now still overrides)
  | 'not_executable';     // a system/coordination chore (e.g. an AI Manager run task) — never dispatched to an agent

/**
 * How many consecutive FAILED runs a ticket may accumulate before autonomy stops
 * auto-re-dispatching it. The reported failure mode: a single ticket auto-ran 30+
 * times, every run failing (e.g. no reachable coding model → `coding_model_degraded`
 * → a backstop that loops on search and ships nothing), and nothing halted the burn.
 * Past this streak the ticket is surfaced as `run_cap_exhausted` for a human/manager
 * to intervene, instead of silently churning identical failing runs. A human clicking
 * "Run now" (which dispatches off `candidate`, not `canRunNow`) is the explicit escape
 * hatch — it forces a run and, on success, breaks the streak.
 */
export const MAX_CONSECUTIVE_AUTORUN_FAILURES = 3;

/**
 * Count the ticket's most-recent consecutive FAILED runs. `execs` is newest-first
 * (ExecutionRepository.findByTask orders createdAt DESC). Counts leading `failed`
 * rows and STOPS at the first run that is not a failure — a `completed` or a
 * deliberate `cancelled` (or any live run) resets the streak, so the breaker only
 * trips on an unbroken run of failures and clears the moment one run does not fail.
 * Pure — unit-tested directly.
 */
export function trailingFailureStreak(execs: ReadonlyArray<{ status: string }>): number {
  let n = 0;
  for (const e of execs) {
    if (e.status === ExecutionStatus.FAILED) n += 1;
    else break;
  }
  return n;
}

export interface AutoRunEvaluation {
  status: string;
  /** The ticket's owner agent (tasks.assigned_agent_ref), if any. */
  assignedAgentRef: string | null;
  laneResolved: boolean;
  isTerminalLane: boolean;
  laneGate: 'auto' | 'human' | null;
  /** Agent refs explicitly staffed on the lane (excludes the owner fallback). */
  staffedAgentRefs: string[];
  /** The gate-respecting autonomy decision (drives {@link maybeAutoRunOnLaneEntry}). */
  decision: LaneAutoRunDecision;
  /**
   * The agent a MANUAL "Run now" would dispatch as — the first candidate (lane
   * staffing, then owner) that satisfies its capability requirement, IGNORING the
   * lane gate (an explicit human click overrides a 'human' gate). Null when no
   * agent at all can run the ticket.
   */
  candidate: { agentRef: string; model?: string } | null;
  /** A live (pending/submitted/running/paused) execution already on the ticket. */
  liveExecution: { id: number; status: string } | null;
  /** True when autonomy would dispatch right now with no further input. */
  canRunNow: boolean;
  reason: AutoRunReason;
}

/**
 * Pure classifier for a RESOLVED, non-terminal lane: turn the gate + decision +
 * guards into the triage reason and whether autonomy fires now. Mirrors the
 * trigger's priority order exactly (gate → no-agent/mismatch → loop guard → live
 * run → run). Split out so the verdict is unit-tested without a DB.
 */
export function classifyResolvedAutoRun(input: {
  gate: 'auto' | 'human';
  decisionAutoRun: boolean;
  hasCapabilityMismatch: boolean;
  sameLaneReentry: boolean;
  hasLiveExecution: boolean;
  /** Consecutive most-recent FAILED runs on the ticket (see {@link trailingFailureStreak}). */
  consecutiveFailures?: number;
}): { reason: AutoRunReason; canRunNow: boolean } {
  if (input.gate === 'human') return { reason: 'human_gate', canRunNow: false };
  if (!input.decisionAutoRun) return { reason: input.hasCapabilityMismatch ? 'capability_mismatch' : 'no_agent', canRunNow: false };
  if (input.sameLaneReentry) return { reason: 'already_running', canRunNow: false };
  if (input.hasLiveExecution) return { reason: 'already_running', canRunNow: false };
  // Circuit-breaker: a ticket that would otherwise auto-run but whose last N runs all
  // failed is halted so autonomy stops re-dispatching an identically-failing run. A
  // human Run-now still overrides (it dispatches off `candidate`, not `canRunNow`).
  if ((input.consecutiveFailures ?? 0) >= MAX_CONSECUTIVE_AUTORUN_FAILURES) return { reason: 'run_cap_exhausted', canRunNow: false };
  return { reason: 'will_run', canRunNow: true };
}

const ACTIVE_STATUSES = new Set<string>([
  ExecutionStatus.PENDING,
  ExecutionStatus.SUBMITTED,
  ExecutionStatus.RUNNING,
  ExecutionStatus.PAUSED,
]);

/**
 * Resolve the lane the ticket sits in, the agents that could work it (lane
 * staffing + the ticket owner as a fallback), the autonomy decision, and any live
 * run — returning a structured, explainable verdict. Pure-ish: only reads (plus
 * the orphan-reap-on-read that `listByTask` already performs, which is idempotent).
 */
export async function evaluateTaskAutoRun(
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; taskId: number; status: string; originLaneKey?: string },
): Promise<AutoRunEvaluation> {
  const [taskRow] = await db
    .select({ assignedAgentRef: tasks.assignedAgentRef, source: tasks.source })
    .from(tasks)
    .where(eq(tasks.id, args.taskId))
    .limit(1);
  const assignedAgentRef = taskRow?.assignedAgentRef ?? null;

  const base = (over: Partial<AutoRunEvaluation> & { reason: AutoRunReason }): AutoRunEvaluation => ({
    status: args.status,
    assignedAgentRef,
    laneResolved: false,
    isTerminalLane: false,
    laneGate: null,
    staffedAgentRefs: [],
    decision: { autoRun: false },
    candidate: null,
    liveExecution: null,
    canRunNow: false,
    ...over,
  });

  // System/coordination chores (e.g. an AI Manager "Backlog management pass" task)
  // are assigned to the manager agent for board VISIBILITY, but they are not codeable
  // work — a coding agent must never pick one up and try to "execute" it. This single
  // guard covers every dispatch entry point (lane trigger, mechanical sweep, manager
  // dispatch pass, manual Run-now) since they all resolve through here.
  if (taskRow?.source === 'manager') return base({ reason: 'not_executable' });

  // Done / terminal status: the ticket is finalized (commit + PR), never auto-run.
  if (args.status === TaskStatus.DONE) return base({ reason: 'terminal_lane', isTerminalLane: true });

  const [board] = await db.select({ id: boards.id, lifecycleManaged: boards.lifecycleManaged }).from(boards).where(eq(boards.projectId, args.projectId)).limit(1);
  if (!board) return base({ reason: 'no_board' });

  const [lane] = await db
    .select({ id: swimlanes.id, gate: swimlanes.gate, isTerminal: swimlanes.isTerminal })
    .from(swimlanes)
    .where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.key, args.status)))
    .limit(1);
  if (!lane) return base({ reason: 'no_lane' });

  const gate: 'auto' | 'human' = lane.gate === 'human' ? 'human' : 'auto';
  if (lane.isTerminal) return base({ reason: 'terminal_lane', laneResolved: true, isTerminalLane: true, laneGate: gate });

  const rows = await db
    .select({
      agentRef: swimlaneAgentAssignments.agentRef,
      model: swimlaneAgentAssignments.model,
      requiredCapabilities: swimlaneAgentAssignments.requiredCapabilities,
    })
    .from(swimlaneAgentAssignments)
    .where(eq(swimlaneAgentAssignments.swimlaneId, lane.id));

  const laneAgents = await Promise.all(
    rows.map(async (r): Promise<LaneAgentLike> => {
      const requiredCapabilities = parseRequiredCapabilities(r.requiredCapabilities);
      let capabilities: string[] | undefined;
      if (requiredCapabilities.length > 0 && r.agentRef) {
        const resolved = await resolveArtifacts(db, { tenantId: args.tenantId, taskId: args.taskId, cloudAgentRef: r.agentRef })
          .catch(() => ({ skills: [], personas: [], content: [] }));
        capabilities = [...resolved.skills, ...resolved.personas];
      }
      return { agentRef: r.agentRef, model: r.model, requiredCapabilities, capabilities };
    }),
  );
  const staffedAgentRefs = laneAgents.map((a) => a.agentRef).filter((r): r is string => !!r);

  // Owner-fallback guardrail — the #467 fix. If this lane has a required PRODUCER role
  // (a role requirement with owner/contributor responsibility), the ticket owner may
  // be used as the auto-run fallback ONLY when it is actually capable of that role.
  // A Product Manager owner must never auto-run an Implementation stage as the coder;
  // suppressing the fallback surfaces the lane as `no_agent` so the Coordinator/manager
  // resolves the right producer instead of the wrong owner burning failing runs.
  let ownerFallbackRef: string | null = assignedAgentRef;
  if (assignedAgentRef) {
    if (board.lifecycleManaged) {
      // Lifecycle-managed board (PRD §5.5): the Assignee IS the Coordinator and is
      // NEVER the default per-stage executor — the per-stage producer is resolved by
      // role capability (the lane gate / manifest), so drop the owner→executor fallback.
      ownerFallbackRef = null;
    } else {
      const reqRows = await db
        .select({ ref: swimlaneRequirements.ref, responsibility: swimlaneRequirements.responsibility, position: swimlaneRequirements.position })
        .from(swimlaneRequirements)
        .where(and(eq(swimlaneRequirements.swimlaneId, lane.id), eq(swimlaneRequirements.kind, 'role'), eq(swimlaneRequirements.isRequired, true)))
        .orderBy(asc(swimlaneRequirements.position));
      const producer = reqRows.find((r) => r.responsibility == null || r.responsibility === 'owner' || r.responsibility === 'contributor');
      if (producer && !(await isAgentRefRoleCapable(db, args.tenantId, assignedAgentRef, producer.ref))) {
        ownerFallbackRef = null;
      }
    }
  }

  const agents = withOwnerAgentFallback(laneAgents, { agentRef: ownerFallbackRef });
  const decision = decideLaneAutoRun(agents, gate);
  // The agent a manual Run-now would use: the same pick, but gate-blind (a human
  // click overrides a 'human' gate). decideLaneAutoRun(_, 'auto') never returns a
  // gate-block, so it surfaces the first capability-qualified candidate or none.
  const forced = decideLaneAutoRun(agents, 'auto');
  const candidate = forced.autoRun && forced.agentRef
    ? { agentRef: forced.agentRef, ...(forced.model ? { model: forced.model } : {}) }
    : null;

  const execs = await runtimeService.listByTask(args.taskId);
  // Newest-first (findByTask orders createdAt DESC) — reused for the live-run check
  // AND the consecutive-failure streak that drives the run_cap_exhausted breaker.
  const plainExecs = execs.map((e) => e.toPlain());
  const liveRow = plainExecs.find((e) => ACTIVE_STATUSES.has(e.status));
  const liveExecution = liveRow ? { id: liveRow.id, status: liveRow.status } : null;

  const { reason, canRunNow } = classifyResolvedAutoRun({
    gate,
    decisionAutoRun: decision.autoRun,
    hasCapabilityMismatch: !!decision.capabilityMismatches?.length,
    sameLaneReentry: !!args.originLaneKey && args.originLaneKey === args.status,
    hasLiveExecution: !!liveExecution,
    consecutiveFailures: trailingFailureStreak(plainExecs),
  });

  return {
    status: args.status,
    assignedAgentRef,
    laneResolved: true,
    isTerminalLane: false,
    laneGate: gate,
    staffedAgentRefs,
    decision,
    candidate,
    liveExecution,
    canRunNow,
    reason,
  };
}

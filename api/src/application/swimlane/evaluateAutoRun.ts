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
import { and, eq } from 'drizzle-orm';
import { boards, swimlanes, swimlaneAgentAssignments, tasks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { resolveArtifacts } from '../artifact/resolveArtifacts';
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
  | 'already_running';    // a live run already exists (or a same-lane re-entry loop guard)

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
}): { reason: AutoRunReason; canRunNow: boolean } {
  if (input.gate === 'human') return { reason: 'human_gate', canRunNow: false };
  if (!input.decisionAutoRun) return { reason: input.hasCapabilityMismatch ? 'capability_mismatch' : 'no_agent', canRunNow: false };
  if (input.sameLaneReentry) return { reason: 'already_running', canRunNow: false };
  if (input.hasLiveExecution) return { reason: 'already_running', canRunNow: false };
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
    .select({ assignedAgentRef: tasks.assignedAgentRef })
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

  // Done / terminal status: the ticket is finalized (commit + PR), never auto-run.
  if (args.status === TaskStatus.DONE) return base({ reason: 'terminal_lane', isTerminalLane: true });

  const [board] = await db.select({ id: boards.id }).from(boards).where(eq(boards.projectId, args.projectId)).limit(1);
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

  const agents = withOwnerAgentFallback(laneAgents, { agentRef: assignedAgentRef });
  const decision = decideLaneAutoRun(agents, gate);
  // The agent a manual Run-now would use: the same pick, but gate-blind (a human
  // click overrides a 'human' gate). decideLaneAutoRun(_, 'auto') never returns a
  // gate-block, so it surfaces the first capability-qualified candidate or none.
  const forced = decideLaneAutoRun(agents, 'auto');
  const candidate = forced.autoRun && forced.agentRef
    ? { agentRef: forced.agentRef, ...(forced.model ? { model: forced.model } : {}) }
    : null;

  const execs = await runtimeService.listByTask(args.taskId);
  const liveRow = execs.map((e) => e.toPlain()).find((e) => ACTIVE_STATUSES.has(e.status));
  const liveExecution = liveRow ? { id: liveRow.id, status: liveRow.status } : null;

  const { reason, canRunNow } = classifyResolvedAutoRun({
    gate,
    decisionAutoRun: decision.autoRun,
    hasCapabilityMismatch: !!decision.capabilityMismatches?.length,
    sameLaneReentry: !!args.originLaneKey && args.originLaneKey === args.status,
    hasLiveExecution: !!liveExecution,
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

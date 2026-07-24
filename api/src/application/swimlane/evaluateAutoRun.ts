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
import { boards, swimlanes, swimlaneAgentAssignments, swimlaneRequirements, tasks, ticketParticipants } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { resolveArtifacts } from '../artifact/resolveArtifacts';
import { isAgentRefRoleCapable } from '../kanban/roleCapability';
import { decideLaneAutoRun, withOwnerAgentFallback, type LaneAgentLike, type LaneAutoRunDecision } from './laneAutoRun';
import { findCanonicalBoard } from './canonicalBoard';
import { isUnapprovedFeedbackTask } from '../feedback/feedbackSpec';
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
  | 'cooldown_active'     // the ticket's last run failed too recently — backing off before the next autonomous attempt (a human Run-now still overrides)
  | 'not_executable'      // a system/coordination chore (e.g. an AI Manager run task) — never dispatched to an agent
  | 'pending_approval';   // an EXTERNAL feedback request — a human must accept it in triage before any agent may touch it

/**
 * One English sentence per {@link AutoRunReason} — what a NON-UI caller should be
 * told about why the ticket is or isn't working right now.
 *
 * The board's triage chip renders localized copy from the `board.triage` catalog;
 * this is the machine-caller counterpart, used by the MCP task tools so an agent
 * that just assigned a ticket learns whether the assignment actually started a run.
 * Without it the Brain reassigned seven tickets to a coder, every dispatch was
 * declined for a real reason, and the tool results said only "here is the updated
 * row" — so the user was told work had started when nothing had.
 */
export const AUTO_RUN_REASON_TEXT: Record<AutoRunReason, string> = {
  will_run: 'A run was dispatched for this ticket.',
  no_board: 'No run: the project has no board, so there is no lane to resolve against.',
  no_lane: 'No run: no swimlane on the board matches this ticket\'s status key.',
  terminal_lane: 'No run: the ticket is in a terminal (Done) lane, which never auto-runs.',
  human_gate: 'No run: this lane is human-gated — a person must approve it or use Run now.',
  no_agent: 'No run: the lane has no staffed agent and the ticket owner is not eligible to execute this stage. Staff the lane, or dispatch explicitly with Run now.',
  capability_mismatch: 'No run: every candidate agent lacks the capabilities this lane requires.',
  already_running: 'No new run: this ticket already has a live execution.',
  run_cap_exhausted: 'No run: the ticket\'s last consecutive runs all failed, so autonomy has stopped re-dispatching it. A human Run now overrides.',
  cooldown_active: 'No run yet: the ticket is in its post-failure back-off window before the next autonomous attempt.',
  not_executable: 'No run: this is a system/coordination chore, never dispatched to an agent.',
  pending_approval: 'No run: this is an external feedback request awaiting human acceptance in triage.',
};

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

/**
 * Per-ticket re-run cooldown — the backpressure between the 3-strike circuit
 * breaker and "no backpressure at all".
 *
 * Before this, a ticket whose run failed could be re-dispatched on the very next
 * 5-minute sweep tick: the ONLY guards were {@link MAX_CONSECUTIVE_AUTORUN_FAILURES}
 * (which allows 3 back-to-back failing runs first) and a per-tenant per-tick
 * dispatch ceiling. Two failing runs a few seconds apart burn tokens for nothing —
 * a transient cause (rate limit, provider blip, a locked branch) needs wall-clock
 * time to clear, not an instant retry.
 *
 * So each consecutive failure doubles the wait before the NEXT autonomous attempt:
 * BASE, 2×BASE, 4×BASE … capped at {@link AUTORUN_COOLDOWN_MAX_MS}. Deliberately
 * short relative to the breaker (which halts the ticket entirely at 3 strikes) —
 * this is a pause, not a stop. A human clicking "Run now" dispatches off `candidate`
 * rather than `canRunNow`, so it is never subject to the cooldown, exactly like the
 * breaker.
 */
export const AUTORUN_COOLDOWN_BASE_MS = 5 * 60_000;  // 5 min after the 1st failure
export const AUTORUN_COOLDOWN_MAX_MS = 60 * 60_000;  // never back off more than an hour

/** Cooldown window owed after `consecutiveFailures` back-to-back failed runs. 0 for
 *  a ticket with no trailing failure (the common case — no backoff at all). Pure. */
export function autoRunCooldownMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  const scaled = AUTORUN_COOLDOWN_BASE_MS * 2 ** (consecutiveFailures - 1);
  return Math.min(scaled, AUTORUN_COOLDOWN_MAX_MS);
}

/** The end of a run, for cooldown math: when it finished, else its last update. */
interface ExecTiming { status: string; completedAt?: Date | null; updatedAt?: Date | null; createdAt?: Date | null }

/**
 * How much of the per-ticket cooldown is still owed, from the SAME newest-first
 * execution list the breaker counts (`ExecutionRepository.findByTask` orders
 * createdAt DESC) — no second query, no N+1. Returns 0 when the ticket has no
 * trailing failure or the window has already elapsed.
 */
export function autoRunCooldownRemainingMs(execs: ReadonlyArray<ExecTiming>, nowMs: number): number {
  const streak = trailingFailureStreak(execs);
  if (streak === 0) return 0;
  const lastFailure = execs[0];
  const endedAt = lastFailure?.completedAt ?? lastFailure?.updatedAt ?? lastFailure?.createdAt ?? null;
  if (!endedAt) return 0; // untimestamped row — never block on missing data
  const elapsed = nowMs - endedAt.getTime();
  if (!Number.isFinite(elapsed)) return 0;
  const remaining = autoRunCooldownMs(streak) - elapsed;
  return remaining > 0 ? remaining : 0;
}

/** Manifest slot states that still owe work — a completed/waived/skipped producer
 *  must not be re-dispatched for the same stage. */
const OPEN_PARTICIPANT_STATES = new Set(['pending', 'assigned', 'in_progress', 'changes_requested']);

/** A ticket-participation manifest slot, as far as producer selection cares. */
export interface ManifestSlot {
  assigneeRef: string | null;
  responsibility: string;
  state: string;
}

/**
 * Pick the PRODUCER slot from a stage's manifest rows: an owner/contributor
 * responsibility, resolved to an agent, still owing work. Pure — unit-tested
 * directly, with the query kept in {@link manifestProducerRef}.
 */
export function pickManifestProducer(rows: ReadonlyArray<ManifestSlot>): string | null {
  const producer = rows.find((r) =>
    (r.responsibility === 'owner' || r.responsibility === 'contributor')
    && !!r.assigneeRef
    && OPEN_PARTICIPANT_STATES.has(r.state));
  return producer?.assigneeRef ?? null;
}

/**
 * The AGENT that the ticket's participation manifest names as the producer of THIS
 * stage — a required owner/contributor slot for the lane, resolved to a cloud agent
 * and not yet completed.
 *
 * On a lifecycle-managed board the Assignee is the Coordinator, never the per-stage
 * executor (PRD §5.5), so the manifest is the only thing that knows who should
 * actually do the work in this lane. Reading it here is what lets an unstaffed lane
 * dispatch the right producer instead of stalling at `no_agent`.
 *
 * `stageKey` is the swimlane key (see `TicketParticipantsService.deriveManifest`),
 * so the lane's status key matches it directly. Null when the manifest has no open
 * agent-resolved producer for the stage — which correctly reads as `no_agent`.
 */
async function manifestProducerRef(db: Db, tenantId: number, taskId: number, stageKey: string): Promise<string | null> {
  const rows = await db
    .select({
      assigneeRef: ticketParticipants.assigneeRef,
      responsibility: ticketParticipants.responsibility,
      state: ticketParticipants.state,
    })
    .from(ticketParticipants)
    .where(and(
      eq(ticketParticipants.tenantId, tenantId),
      eq(ticketParticipants.taskId, taskId),
      eq(ticketParticipants.stageKey, stageKey),
      eq(ticketParticipants.required, true),
      eq(ticketParticipants.assigneeKind, 'agent'),
    ));

  return pickManifestProducer(rows);
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
  /** Milliseconds still owed on the per-ticket re-run cooldown (0 when none).
   *  Non-zero only alongside `reason: 'cooldown_active'` — surfaced so the triage
   *  UI can say WHEN the ticket resumes rather than just that it is waiting. */
  cooldownRemainingMs: number;
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
  /** Cooldown still owed since the last failed run (see {@link autoRunCooldownRemainingMs}). */
  cooldownRemainingMs?: number;
}): { reason: AutoRunReason; canRunNow: boolean } {
  if (input.gate === 'human') return { reason: 'human_gate', canRunNow: false };
  if (!input.decisionAutoRun) return { reason: input.hasCapabilityMismatch ? 'capability_mismatch' : 'no_agent', canRunNow: false };
  if (input.sameLaneReentry) return { reason: 'already_running', canRunNow: false };
  if (input.hasLiveExecution) return { reason: 'already_running', canRunNow: false };
  // Circuit-breaker: a ticket that would otherwise auto-run but whose last N runs all
  // failed is halted so autonomy stops re-dispatching an identically-failing run. A
  // human Run-now still overrides (it dispatches off `candidate`, not `canRunNow`).
  if ((input.consecutiveFailures ?? 0) >= MAX_CONSECUTIVE_AUTORUN_FAILURES) return { reason: 'run_cap_exhausted', canRunNow: false };
  // Per-ticket re-run cooldown: a ticket whose last run failed backs off (doubling
  // per consecutive failure) before autonomy re-dispatches it, so a transient cause
  // gets wall-clock time to clear instead of being retried on the next 5-min tick.
  // Checked AFTER the breaker so a halted ticket reports the stronger reason. A human
  // Run-now dispatches off `candidate`, not `canRunNow`, so it still overrides.
  if ((input.cooldownRemainingMs ?? 0) > 0) return { reason: 'cooldown_active', canRunNow: false };
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
    cooldownRemainingMs: 0,
    ...over,
  });

  // System/coordination chores (e.g. an AI Manager "Backlog management pass" task)
  // are assigned to the manager agent for board VISIBILITY, but they are not codeable
  // work — a coding agent must never pick one up and try to "execute" it. This single
  // guard covers every dispatch entry point (lane trigger, mechanical sweep, manager
  // dispatch pass, manual Run-now) since they all resolve through here.
  if (taskRow?.source === 'manager') return base({ reason: 'not_executable' });

  // An EXTERNAL REQUEST gathered by a feedback collector: someone outside the
  // delivery team asked for something. It is real work, but nobody has agreed to
  // do it yet — so it is inert until a human accepts it in the feedback triage
  // queue (which flips the marker to `feedback_approved` and lets it behave like
  // ordinary work). Sitting BEFORE lane/agent resolution, and returning a null
  // `candidate`, this blocks EVERY dispatch entry point including manual Run-now:
  // approving the request IS the human's explicit go, so a second override here
  // would just be a way to skip the gate by accident.
  if (isUnapprovedFeedbackTask(taskRow?.source)) return base({ reason: 'pending_approval' });

  // Done / terminal status: the ticket is finalized (commit + PR), never auto-run.
  if (args.status === TaskStatus.DONE) return base({ reason: 'terminal_lane', isTerminalLane: true });

  const board = await findCanonicalBoard(db, args.projectId, args.tenantId);
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

  // The lane's required PRODUCER role (a role requirement with owner/contributor
  // responsibility), if any — used to role-gate BOTH the owner fallback AND the
  // explicitly-staffed lane agents (#467). On a lifecycle-managed board the producer
  // is a manifest-named ref rather than a role key, so this role gate applies to
  // simple boards only (the managed path resolves the producer from the manifest).
  let producerRoleKey: string | null = null;
  if (!board.lifecycleManaged) {
    const reqRows = await db
      .select({ ref: swimlaneRequirements.ref, responsibility: swimlaneRequirements.responsibility, position: swimlaneRequirements.position })
      .from(swimlaneRequirements)
      .where(and(eq(swimlaneRequirements.swimlaneId, lane.id), eq(swimlaneRequirements.kind, 'role'), eq(swimlaneRequirements.isRequired, true)))
      .orderBy(asc(swimlaneRequirements.position));
    const producer = reqRows.find((r) => r.responsibility == null || r.responsibility === 'owner' || r.responsibility === 'contributor');
    producerRoleKey = producer?.ref ?? null;
  }

  // Role-gate explicitly-staffed lane agents, the SAME guardrail as the owner fallback
  // below (#467). A lane staffed with a wrong-role agent (e.g. a designer pinned to an
  // Implementation lane) must not auto-run just because it matches the capability tags;
  // filter it out so the lane surfaces `no_agent` and the manager resolves the right
  // producer instead of burning failing runs. `staffedAgentRefs` keeps the full set for
  // skip-telemetry so a filtered-out staffing is still visible.
  let qualifiedLaneAgents = laneAgents;
  if (producerRoleKey) {
    const roleCapable = await Promise.all(laneAgents.map((a) =>
      a.agentRef ? isAgentRefRoleCapable(db, args.tenantId, a.agentRef, producerRoleKey) : Promise.resolve(true)));
    qualifiedLaneAgents = laneAgents.filter((_, i) => roleCapable[i]);
  }

  // Owner-fallback guardrail — the #467 fix. If this lane has a required PRODUCER role,
  // the ticket owner may be used as the auto-run fallback ONLY when it is actually
  // capable of that role. A Product Manager owner must never auto-run an Implementation
  // stage as the coder; suppressing the fallback surfaces the lane as `no_agent` so the
  // Coordinator/manager resolves the right producer instead of burning failing runs.
  let ownerFallbackRef: string | null = assignedAgentRef;
  if (board.lifecycleManaged) {
    // Lifecycle-managed board (PRD §5.5): the Assignee IS the Coordinator and is
    // NEVER the default per-stage executor. The per-stage PRODUCER is the ticket's
    // own participation manifest slot for this stage — so read it, rather than
    // dropping the fallback outright. The old `null` meant an unstaffed lane simply
    // stalled at `no_agent` forever: assigning a coder to a ticket did nothing, and
    // nothing ever resolved the producer the manifest had already named.
    ownerFallbackRef = await manifestProducerRef(db, args.tenantId, args.taskId, args.status);
  } else if (assignedAgentRef && producerRoleKey) {
    if (!(await isAgentRefRoleCapable(db, args.tenantId, assignedAgentRef, producerRoleKey))) {
      ownerFallbackRef = null;
    }
  }

  const agents = withOwnerAgentFallback(qualifiedLaneAgents, { agentRef: ownerFallbackRef });
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

  // Both the breaker streak and the re-run cooldown are derived from THIS one
  // newest-first list — no second query per ticket (the sweep evaluates hundreds).
  const cooldownRemainingMs = autoRunCooldownRemainingMs(plainExecs, Date.now());

  const { reason, canRunNow } = classifyResolvedAutoRun({
    gate,
    decisionAutoRun: decision.autoRun,
    hasCapabilityMismatch: !!decision.capabilityMismatches?.length,
    sameLaneReentry: !!args.originLaneKey && args.originLaneKey === args.status,
    hasLiveExecution: !!liveExecution,
    consecutiveFailures: trailingFailureStreak(plainExecs),
    cooldownRemainingMs,
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
    cooldownRemainingMs: reason === 'cooldown_active' ? cooldownRemainingMs : 0,
  };
}

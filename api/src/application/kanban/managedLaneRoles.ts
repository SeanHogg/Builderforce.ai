import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * managedLaneRoles — THE answer to "which roles may execute this stage of this ticket,
 * and who can act as one", on a lifecycle-managed board.
 *
 * ── THE FAILURE THIS CLOSES ──────────────────────────────────────────────────────
 * A managed board accepts only role-attributed executions: `authorizeManagedTaskExecution`
 * refuses any dispatch payload without an `actAsRole`/`reviewRole`. The lane trigger
 * (`maybeAutoRunOnLaneEntry`) never produced one — it built `{cloudAgentRef, model,
 * laneKey}` and handed it straight to the dispatcher — so on a managed board the trigger
 * could NEVER dispatch. `dispatchCloudRunForTask` threw, the trigger recorded
 * `auto_run_error`, and because the throw happened BEFORE the execution row existed, no
 * failure was recorded: the 3-strike breaker and the re-run cooldown never engaged and
 * the refusal repeated on every sweep, forever.
 *
 * Every autonomous dispatcher funnels through that trigger — the cron sweep,
 * `system:lane-auto`, the manager's stage-5 dispatch, its triage remedies, ceremonies,
 * the MCP task tools, a board drag. Only `requestRoleRun` callers (the requirement gate's
 * reviewer/producer asks, `driveOutstandingSignoffs`) ever passed. Measured on project 11:
 * task 1032 — a manager systemic-finding ticket — was dead on arrival, and the
 * `unassigned` / `never_started` cohorts are largely this.
 *
 * ── WHY IT IS ONE MODULE AND NOT TWO OPINIONS ────────────────────────────────────
 * The GUARD (which roles are allowed) and the DISPATCHER (which role to send) were
 * deriving the same fact independently. That asymmetry is the whole bug class — the same
 * shape that had already emptied the sign-off ledger when the role SELECTOR and the
 * sign-off GATE disagreed about what "role-capable" means. So the authority is resolved
 * once here, and both sides read it: the guard cannot refuse what the dispatcher sends,
 * because the dispatcher only sends what this module authorized.
 *
 * ── COST ─────────────────────────────────────────────────────────────────────────
 * {@link resolveManagedLaneAuthority} is the single-lane path (the guard, the evaluator).
 * {@link loadBoardLaneAuthorities} is the BULK path for the census, which must classify
 * every ticket in a project: it loads a whole board's lanes, requirements and staffing in
 * four queries and then decides per ticket in memory, so a 675-ticket census costs four
 * round-trips, not 675 (or even one per lane).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { swimlaneRequirements, swimlanes, ticketParticipants } from '../../infrastructure/database/schema';
import {
  builtinRoleKeyFromText, decideLaneApprovers, loadStaffedAgentsForLanes,
  type LaneApprover, type LaneApproverTier, type LaneStaffedAgent,
} from '../swimlane/laneApprover';
import { isParticipantOpen } from './participantStates';
import { isReviewRole } from './roleCatalog';
import { requirementApplies } from './types';

/** The ticket facts a requirement's applicability is scoped by. */
export interface ManagedTaskScope {
  taskType?: string | null;
  actionType?: string | null;
}

/** What a managed stage authorizes for ONE ticket. */
export interface ManagedLaneAuthority {
  /**
   * Role keys this stage authorizes for this ticket — the set the guard enforces and the
   * dispatcher must pick from. Empty means the stage authorizes nothing, which is a
   * FAIL-CLOSED verdict (no dispatch), never "anything goes".
   */
  roleKeys: string[];
  /** The resolved approvers. Tier (a) carries no agent; tier (b) always does. */
  approvers: LaneApprover[];
  tier: LaneApproverTier;
}

/** The lane inputs a per-ticket authority decision needs, loaded once per lane. */
export interface LaneAuthorityInputs {
  requirements: Array<{ kind: string; ref: string; ticketType: string | null; condition: string | null }>;
  laneAgents: LaneStaffedAgent[];
}

/**
 * Give each authorized role a concrete agent from the lane's staffing. PURE.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * `decideLaneApprovers` answers "who must APPROVE this lane?", and on tier (a) it
 * deliberately leaves `agentRef` null: the approval gate resolves the agent for a
 * required role through its own path, so the approver decision never needed one.
 *
 * Execution asks a DIFFERENT question — "who may ACT AS this required role?" — and it
 * does need one. Reading the approver answer as if it were the execution answer meant a
 * templated lane could never produce an agent, so {@link pickManagedProducer} always fell
 * through to null and every ticket on such a lane classified `managed_no_role`. Measured
 * on project 11 after the role-attribution fix shipped: 405 of 675 stalled tickets, the
 * single largest cohort on the board — stages that DID declare a required role, on lanes
 * that WERE staffed with an agent capable of it, refused because the two facts were never
 * put together.
 *
 * The operator's staffing plus `agentRoleKeys` capability IS the answer to who may act as
 * a required role, so the binding happens here rather than being a second opinion
 * somewhere downstream. An unbound role stays unbound (`agentRef: null`): it remains
 * authorized — the gate may still be satisfied by a human or a later assignment — but it
 * cannot be dispatched, which is the honest fail-closed verdict.
 *
 * Sub-precedence per role, matching {@link approverRoleKeyForLaneAgent}: an agent whose
 * DECLARED assignment role names this role beats one that is merely capable of it, then
 * lane position. Unlike approver resolution this does NOT dedupe by agent — one agent
 * staffed on a lane may legitimately act as several of its required roles.
 */
export function bindStaffedAgentsToRoles(
  approvers: readonly LaneApprover[],
  laneAgents: readonly LaneStaffedAgent[],
): LaneApprover[] {
  if (laneAgents.length === 0) return [...approvers];
  const ordered = [...laneAgents].sort(
    (a, b) => a.position - b.position || a.agentRef.localeCompare(b.agentRef),
  );
  return approvers.map((approver) => {
    if (approver.agentRef) return approver;
    const capable = ordered.filter((a) => a.capableRoleKeys.includes(approver.roleKey));
    if (capable.length === 0) return approver;
    const chosen = capable.find((a) => builtinRoleKeyFromText(a.declaredRole) === approver.roleKey) ?? capable[0]!;
    return { ...approver, agentRef: chosen.agentRef, agentName: chosen.agentName, model: chosen.model };
  });
}

/**
 * Decide a stage's authority for one ticket. PURE — the queries live in
 * {@link resolveManagedLaneAuthority} / {@link loadBoardLaneAuthorities}.
 *
 * Requirement rows are filtered by {@link requirementApplies} FIRST, so a requirement that
 * does not apply to this ticket (a security-only reviewer on a docs ticket) correctly
 * cannot suppress the lane-staffing tier — the same rule `decideLaneApprovers` documents.
 *
 * `roleKeys` — the set the guard enforces — is taken from the approver decision UNCHANGED.
 * Only the agent binding is added on top (see {@link bindStaffedAgentsToRoles}), so this
 * widens nothing: exactly the same roles are authorized, some of them now dispatchable.
 */
export function decideManagedLaneAuthority(
  inputs: LaneAuthorityInputs,
  task: ManagedTaskScope,
): ManagedLaneAuthority {
  const requirementRoleKeys = inputs.requirements
    .filter((r) => (r.kind === 'role' || r.kind === 'review')
      && requirementApplies({ ticketType: r.ticketType, condition: r.condition }, task))
    .map((r) => r.ref);
  const decision = decideLaneApprovers({ requirementRoleKeys, laneAgents: inputs.laneAgents });
  return {
    roleKeys: decision.approvers.map((a) => a.roleKey),
    approvers: bindStaffedAgentsToRoles(decision.approvers, inputs.laneAgents),
    tier: decision.tier,
  };
}

/**
 * Does the ticket's OWN manifest authorize this role at this stage? PURE.
 *
 * A required participation slot is the lifecycle's recorded decision that this role owes
 * work on this ticket at this stage — strictly more specific than the lane template, and
 * created by the coordinator, not by the caller. So an open required slot authorizes its
 * own role even when the ticket has since moved on to a lane whose template does not name
 * it. Without this, an outstanding pre-review slot (Developer, Business Analyst) could
 * never be asked once the ticket reached `in_review`: measured on project 11, the gate
 * held 24 tickets and dispatched sign-off requests to exactly zero of them.
 *
 * Scoped to OPEN states, so a satisfied or waived slot grants nothing.
 */
export function slotAuthorizesRole(slots: readonly ManagedProducerSlot[], roleKey: string): boolean {
  return slots.some((s) => s.roleKey === roleKey && isParticipantOpen(s.state));
}

/** A manifest slot, as far as producer selection cares. */
export interface ManagedProducerSlot {
  roleKey: string;
  responsibility: string;
  state: string;
  assigneeKind: string | null;
  assigneeRef: string | null;
}

/** The role-attributed run a managed stage would start. */
export interface ManagedProducer {
  roleKey: string;
  agentRef: string;
  model: string | null;
  /** Where the pick came from — the ticket's own manifest, or the lane's staffing. */
  source: 'manifest' | 'lane_agent';
}

/**
 * Pick the role-attributed producer for a managed stage. PURE.
 *
 * Order, most-specific first:
 *  1. the ticket's OWN manifest — an open owner/contributor slot resolved to an agent,
 *     whose role the stage authorizes. This is the Coordinator's recorded intent for this
 *     ticket, so it beats a generic lane pick.
 *  2. the lane's staffing (tier b) — the operator staffed this agent to work this lane,
 *     and `decideLaneApprovers` already mapped it to a role it is genuinely capable of.
 *
 * A manifest slot whose role the stage does NOT authorize is deliberately skipped rather
 * than dispatched: the guard would refuse it, and a dispatch guaranteed to be refused is
 * exactly the loop this module exists to end.
 *
 * Null means no role-attributed run is possible here — read by the evaluator as
 * `managed_no_role`, never as permission to dispatch un-attributed.
 */
export function pickManagedProducer(
  authority: ManagedLaneAuthority,
  slots: readonly ManagedProducerSlot[],
): ManagedProducer | null {
  const authorized = new Set(authority.roleKeys);

  const slot = slots.find((s) =>
    (s.responsibility === 'owner' || s.responsibility === 'contributor')
    && s.assigneeKind === 'agent'
    && !!s.assigneeRef
    && isParticipantOpen(s.state)
    && authorized.has(s.roleKey));
  if (slot?.assigneeRef) {
    const approver = authority.approvers.find((a) => a.roleKey === slot.roleKey);
    return { roleKey: slot.roleKey, agentRef: slot.assigneeRef, model: approver?.model ?? null, source: 'manifest' };
  }

  // A PRODUCER builds the stage's deliverable, so a producing role is preferred over a
  // reviewing one even when the reviewer is listed first: dispatching a Code Reviewer to
  // write the code it is meant to judge is a run that cannot succeed and cannot be
  // reviewed. Falls back to any bound role, because a stage whose only authorized role is
  // a review role still needs SOMEBODY to act on it.
  const bound = authority.approvers.filter((a) => !!a.agentRef);
  const staffed = bound.find((a) => !isReviewRole(a.roleKey)) ?? bound[0];
  if (staffed?.agentRef) {
    return { roleKey: staffed.roleKey, agentRef: staffed.agentRef, model: staffed.model, source: 'lane_agent' };
  }
  return null;
}

/** Requirement rows for one lane, unfiltered (applicability is a per-ticket decision). */
async function loadLaneRequirements(db: Db, tenantId: number, swimlaneId: string): Promise<LaneAuthorityInputs['requirements']> {
  return db
    .select({
      kind: swimlaneRequirements.kind,
      ref: swimlaneRequirements.ref,
      ticketType: swimlaneRequirements.ticketType,
      condition: swimlaneRequirements.condition,
    })
    .from(swimlaneRequirements)
    .where(and(
      eq(swimlaneRequirements.tenantId, tenantId),
      eq(swimlaneRequirements.swimlaneId, swimlaneId),
      eq(swimlaneRequirements.isRequired, true),
    ));
}

/**
 * A managed stage's authority for one ticket — the single-lane (guard / evaluator) path.
 *
 * Staffing is read on EVERY path, including tier (a). It used to be skipped whenever a
 * requirement applied ("a templated lane costs exactly one query"), which is precisely
 * what left tier (a) with no agent to dispatch — see {@link bindStaffedAgentsToRoles}. The
 * saving was one batched read on a path that then starts a billable LLM run; the cost was
 * the largest stall cohort on the board.
 *
 * Deliberately NOT cached. This is dispatch-time authorization, not a read endpoint: the
 * whole failure mode being fixed here is a stage refusing a dispatch it should allow, and
 * a stale staffing entry would reintroduce exactly that from four separate write sites
 * (boardRoutes, DrizzleCoordinatorStore, rosterService, QaFindingRouter). The bulk census
 * path pays it once per board via {@link loadBoardLaneAuthorities}.
 */
export async function resolveManagedLaneAuthority(
  db: Db,
  args: { tenantId: number; swimlaneId: string; task: ManagedTaskScope },
): Promise<ManagedLaneAuthority> {
  const [requirements, staffed] = await Promise.all([
    loadLaneRequirements(db, args.tenantId, args.swimlaneId),
    loadStaffedAgentsForLanes(db, args.tenantId, [args.swimlaneId]),
  ]);
  const laneAgents = staffed.get(args.swimlaneId) ?? [];
  return decideManagedLaneAuthority({ requirements, laneAgents }, args.task);
}

/** Open required manifest slots for ONE ticket's current stage. */
export async function loadStageProducerSlots(
  db: Db,
  args: { tenantId: number; taskId: number; stageKey: string },
): Promise<ManagedProducerSlot[]> {
  return db
    .select({
      roleKey: ticketParticipants.roleKey,
      responsibility: ticketParticipants.responsibility,
      state: ticketParticipants.state,
      assigneeKind: ticketParticipants.assigneeKind,
      assigneeRef: ticketParticipants.assigneeRef,
    })
    .from(ticketParticipants)
    .where(and(
      eq(ticketParticipants.tenantId, args.tenantId),
      eq(ticketParticipants.taskId, args.taskId),
      eq(ticketParticipants.stageKey, args.stageKey),
      eq(ticketParticipants.required, true),
    ));
}

/**
 * The role-attributed run a managed ticket's current stage would start, or null.
 * The evaluator's entry point — one authority read plus one manifest read.
 */
export async function resolveManagedProducer(
  db: Db,
  args: { tenantId: number; taskId: number; swimlaneId: string; stageKey: string; task: ManagedTaskScope },
): Promise<{ producer: ManagedProducer | null; authority: ManagedLaneAuthority }> {
  const [authority, slots] = await Promise.all([
    resolveManagedLaneAuthority(db, { tenantId: args.tenantId, swimlaneId: args.swimlaneId, task: args.task }),
    loadStageProducerSlots(db, { tenantId: args.tenantId, taskId: args.taskId, stageKey: args.stageKey }),
  ]);
  return { producer: pickManagedProducer(authority, slots), authority };
}

/**
 * BULK: every lane's authority inputs for a whole board, in THREE queries (requirements,
 * staffing, and the one batched agent-capability read inside `loadLaneStaffedAgents`'s
 * bulk sibling below). Keyed by swimlane id.
 *
 * The census classifies every ticket in a project, so a per-ticket — or even a per-lane —
 * resolution would be the N+1 the caching rules forbid. Requirements are returned
 * unfiltered because applicability depends on the TICKET, and the caller applies
 * {@link decideManagedLaneAuthority} per ticket in memory.
 */
export async function loadBoardLaneAuthorities(
  db: Db,
  args: { tenantId: number; boardId: string },
): Promise<Map<string, LaneAuthorityInputs>> {
  const laneRows = await db
    .select({ id: swimlanes.id })
    .from(swimlanes)
    .where(and(eq(swimlanes.tenantId, args.tenantId), eq(swimlanes.boardId, args.boardId)));
  const laneIds = laneRows.map((l) => l.id);
  const out = new Map<string, LaneAuthorityInputs>();
  if (laneIds.length === 0) return out;
  for (const id of laneIds) out.set(id, { requirements: [], laneAgents: [] });

  const [requirementRows, staffed] = await Promise.all([
    db
      .select({
        swimlaneId: swimlaneRequirements.swimlaneId,
        kind: swimlaneRequirements.kind,
        ref: swimlaneRequirements.ref,
        ticketType: swimlaneRequirements.ticketType,
        condition: swimlaneRequirements.condition,
      })
      .from(swimlaneRequirements)
      .where(and(
        eq(swimlaneRequirements.tenantId, args.tenantId),
        inArray(swimlaneRequirements.swimlaneId, laneIds),
        eq(swimlaneRequirements.isRequired, true),
      ))
      .catch((error) => {
        reportCaughtError(error, { source: "application/kanban/managedLaneRoles.ts", operation: "[requirementRows, staffed]", context: { logMessage: '[managed-lane-roles] board requirement load failed', details: {
          tenantId: args.tenantId,
          boardId: args.boardId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } });
        return [];
      }),
    loadStaffedAgentsForLanes(db, args.tenantId, laneIds).catch((error) => {
      reportCaughtError(error, { source: "application/kanban/managedLaneRoles.ts", operation: "[requirementRows, staffed]", context: { logMessage: '[managed-lane-roles] board staffing load failed', details: {
        tenantId: args.tenantId,
        boardId: args.boardId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
      return new Map<string, LaneStaffedAgent[]>();
    }),
  ]);

  for (const r of requirementRows) {
    out.get(r.swimlaneId)?.requirements.push({ kind: r.kind, ref: r.ref, ticketType: r.ticketType, condition: r.condition });
  }
  for (const [laneId, agents] of staffed) {
    const entry = out.get(laneId);
    if (entry) entry.laneAgents = agents;
  }
  return out;
}

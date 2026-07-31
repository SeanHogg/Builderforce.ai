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
import type { Env } from '../../env';
import { swimlaneRequirements, swimlanes, ticketParticipants } from '../../infrastructure/database/schema';
import {
  builtinRoleKeyFromText, decideLaneApprovers, loadStaffedAgentsForLanes,
  type LaneApprover, type LaneApproverTier, type LaneStaffedAgent,
} from '../swimlane/laneApprover';
import { EMPTY_ROLE_ROSTER, loadRoleRoster, type RoleRoster } from './roleCapability';
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
  /** The resolved approvers, each bound to an agent where one could be resolved. */
  approvers: BoundLaneApprover[];
  tier: LaneApproverTier;
}

/** The lane inputs a per-ticket authority decision needs, loaded once per lane. */
export interface LaneAuthorityInputs {
  requirements: Array<{ kind: string; ref: string; ticketType: string | null; condition: string | null }>;
  laneAgents: LaneStaffedAgent[];
  /**
   * The lane's `key` — which is also the ticket STATUS that lands in it (see the lane
   * lookup in `evaluateAutoRun`: `swimlanes.key === task.status`). Optional so existing
   * constructions stay valid; supplied by {@link loadBoardLaneAuthorities}.
   *
   * Carried so a staffing gap can be reported as the stage a human recognises ("ready")
   * and correlated against the tickets sitting in it, rather than as a bare uuid.
   */
  laneKey?: string | null;
  /**
   * The workspace roster — the SAME capability oracle the execution guard enforces.
   *
   * REQUIRED, deliberately. An optional roster is what let this seam reopen twice: the
   * omission is invisible at the call site and surfaces weeks later as a stalled board.
   * A caller that genuinely must not bind agents passes {@link EMPTY_ROLE_ROSTER} and
   * says why.
   */
  roster: RoleRoster;
}

/** An approver plus WHERE its agent came from, so the verdict can say. */
export type BoundLaneApprover = LaneApprover & { boundVia?: 'lane_agent' | 'roster' };

/**
 * Give each authorized role a concrete agent. PURE.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * `decideLaneApprovers` answers "who must APPROVE this lane?", and on tier (a) it
 * deliberately leaves `agentRef` null: the approval gate resolves the agent for a
 * required role through its own path, so the approver decision never needed one.
 *
 * Execution asks a DIFFERENT question — "who may ACT AS this required role?" — and it
 * does need one. Reading the approver answer as if it were the execution answer meant a
 * templated lane could never produce an agent, so {@link pickManagedProducer} always fell
 * through to null and every ticket on such a lane classified `managed_no_role`.
 *
 * ── THE TWO SOURCES, AND WHY BOTH ────────────────────────────────────────────────
 *   1. LANE STAFFING — the operator staffed this agent to work this lane. The most
 *      specific configuration there is, so it wins, and it carries the lane's pinned
 *      model.
 *   2. THE ROSTER — anyone the capability oracle says can act as the role: an explicit
 *      pin, declared `role_keys`, `builtin_kind`, or a title/skill match.
 *
 * Source 2 is not an enhancement, it is the parity. The execution guard has always
 * accepted all four of those paths, so a stage whose role only the roster can fill was
 * authorized-but-unselectable: the guard would have waved the agent through and nothing
 * could nominate it. Measured on project 11 with only source 1 wired: 3 of 61 auto-gated
 * lanes carried any staffing, and 447 of 678 stalled tickets — 66% of the board —
 * classified `managed_no_role` while a capable built-in agent sat idle on the roster.
 *
 * It is also what makes the manager's staffing ladder real. `staffUnfilledRole` pins a
 * capable teammate (or hires one and pins it) into `project_role_assignments`; with only
 * lane staffing consulted, that pin reached nothing and the remedy reported success while
 * changing nothing.
 *
 * An unbound role stays unbound (`agentRef: null`): it remains authorized — the gate may
 * still be satisfied by a human or a later assignment — but it cannot be dispatched,
 * which is the honest fail-closed verdict.
 *
 * Sub-precedence within lane staffing, matching {@link approverRoleKeyForLaneAgent}: an
 * agent whose DECLARED assignment role names this role beats one that is merely capable
 * of it, then lane position. Unlike approver resolution this does NOT dedupe by agent —
 * one agent may legitimately act as several of a lane's required roles.
 */
export function bindStaffedAgentsToRoles(
  approvers: readonly LaneApprover[],
  laneAgents: readonly LaneStaffedAgent[],
  roster: RoleRoster,
): BoundLaneApprover[] {
  const ordered = [...laneAgents].sort(
    (a, b) => a.position - b.position || a.agentRef.localeCompare(b.agentRef),
  );
  return approvers.map((approver): BoundLaneApprover => {
    if (approver.agentRef) return approver;
    const capable = ordered.filter((a) => a.capableRoleKeys.includes(approver.roleKey));
    if (capable.length > 0) {
      const chosen = capable.find((a) => builtinRoleKeyFromText(a.declaredRole) === approver.roleKey) ?? capable[0]!;
      return { ...approver, agentRef: chosen.agentRef, agentName: chosen.agentName, model: chosen.model, boundVia: 'lane_agent' };
    }
    // The roster's head is the strongest claim to the role (pin → role_keys →
    // builtin_kind → fuzzy). No model: a roster agent carries no lane-pinned model, so
    // the dispatcher picks the workspace default exactly as it does for tier (a).
    const fromRoster = roster.candidates(approver.roleKey)[0];
    if (!fromRoster) return approver;
    return { ...approver, agentRef: fromRoster.ref, agentName: fromRoster.name, model: null, boundVia: 'roster' };
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
    approvers: bindStaffedAgentsToRoles(decision.approvers, inputs.laneAgents, inputs.roster),
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
  /**
   * Where the pick came from — the ticket's own manifest, the lane's staffing, or the
   * workspace roster (a pin, declared role_keys, builtin_kind or a title/skill match).
   */
  source: 'manifest' | 'lane_agent' | 'roster';
}

/**
 * Pick the role-attributed producer for a managed stage. PURE.
 *
 * Order, most-specific first:
 *  1. the ticket's OWN manifest — an open owner/contributor slot resolved to an agent,
 *     which is itself ticket-specific authority recorded by the Coordinator. It beats a
 *     generic lane pick.
 *  2. the lane's staffing (tier b) — the operator staffed this agent to work this lane,
 *     and `decideLaneApprovers` already mapped it to a role it is genuinely capable of.
 *  3. the workspace roster — anyone the capability oracle says can act as the role. This
 *     is the tier the execution guard has always accepted (see
 *     {@link bindStaffedAgentsToRoles}), so omitting it made stages authorized-but-
 *     unselectable: 447 tickets refused for a role a capable agent could have filled.
 *
 * Null means no role-attributed run is possible here — read by the evaluator as
 * `managed_no_role`, never as permission to dispatch un-attributed. It now means what it
 * says: nobody in the workspace can perform the role, which is a staffing decision for
 * `staffUnfilledRole` or a human, not an accident of where the answer was looked up.
 */
export function pickManagedProducer(
  authority: ManagedLaneAuthority,
  slots: readonly ManagedProducerSlot[],
): ManagedProducer | null {
  // An open required manifest slot is ticket-specific lifecycle authority. The
  // execution guard already accepts it even when the generic lane template names no
  // role, so producer selection must apply the same rule.
  const slot = slots.find((s) =>
    (s.responsibility === 'owner' || s.responsibility === 'contributor')
    && s.assigneeKind === 'agent'
    && !!s.assigneeRef
    && isParticipantOpen(s.state));
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
    return {
      roleKey: staffed.roleKey,
      agentRef: staffed.agentRef,
      model: staffed.model,
      // Tier (b) approvers arrive already bound by `decideLaneApprovers` and carry no
      // marker, so an unmarked bind is lane staffing by construction.
      source: staffed.boundVia === 'roster' ? 'roster' : 'lane_agent',
    };
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
  args: { tenantId: number; swimlaneId: string; task: ManagedTaskScope; roster: RoleRoster },
): Promise<ManagedLaneAuthority> {
  const [requirements, staffed] = await Promise.all([
    loadLaneRequirements(db, args.tenantId, args.swimlaneId),
    loadStaffedAgentsForLanes(db, args.tenantId, [args.swimlaneId]),
  ]);
  const laneAgents = staffed.get(args.swimlaneId) ?? [];
  return decideManagedLaneAuthority({ requirements, laneAgents, roster: args.roster }, args.task);
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
  args: {
    tenantId: number; projectId: number; taskId: number; swimlaneId: string;
    stageKey: string; task: ManagedTaskScope; env?: Env;
  },
): Promise<{ producer: ManagedProducer | null; authority: ManagedLaneAuthority }> {
  // The roster is loaded HERE, not passed in, because this is the selector's entry point:
  // every caller of it needs binding, so making them each remember to supply one is the
  // optional-parameter trap that produced the 447-ticket cohort.
  const roster = await loadRoleRoster(args.env, db, args.tenantId, args.projectId);
  const [authority, slots] = await Promise.all([
    resolveManagedLaneAuthority(db, { tenantId: args.tenantId, swimlaneId: args.swimlaneId, task: args.task, roster }),
    loadStageProducerSlots(db, { tenantId: args.tenantId, taskId: args.taskId, stageKey: args.stageKey }),
  ]);
  const producer = pickManagedProducer(authority, slots);
  const effectiveRoleKeys = [...new Set([
    ...authority.roleKeys,
    ...slots.filter((slot) => isParticipantOpen(slot.state)).map((slot) => slot.roleKey),
  ])];
  const effectiveAuthority = effectiveRoleKeys.length === authority.roleKeys.length
    ? authority
    : { ...authority, roleKeys: effectiveRoleKeys };
  return { producer, authority: effectiveAuthority };
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
  args: { tenantId: number; projectId: number; boardId: string; env?: Env },
): Promise<Map<string, LaneAuthorityInputs>> {
  // ONE roster for the whole board, shared by every lane — the census asks the capability
  // question for every authorized role of every lane, and a per-lane load would be the
  // N+1 that makes parity unaffordable.
  // A FAILED roster load must be LOUD. Degrading to `EMPTY_ROLE_ROSTER` reproduces the
  // exact pre-fix symptom — every role unbound, every ticket `managed_no_role` — so a
  // silent catch here would make a broken read indistinguishable from a genuinely
  // unstaffable board, on the one number this whole fix is measured by.
  const roster = await loadRoleRoster(args.env, db, args.tenantId, args.projectId)
    .catch((error) => {
      reportCaughtError(error, { source: 'application/kanban/managedLaneRoles.ts', operation: 'loadBoardLaneAuthorities', context: { logMessage: '[managed-lane-roles] roster load failed — EVERY role on this board will report unbound', details: {
        tenantId: args.tenantId,
        projectId: args.projectId,
        boardId: args.boardId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
      return EMPTY_ROLE_ROSTER;
    });
  const laneRows = await db
    .select({ id: swimlanes.id, key: swimlanes.key })
    .from(swimlanes)
    .where(and(eq(swimlanes.tenantId, args.tenantId), eq(swimlanes.boardId, args.boardId)));
  const laneIds = laneRows.map((l) => l.id);
  const out = new Map<string, LaneAuthorityInputs>();
  if (laneIds.length === 0) return out;
  for (const l of laneRows) out.set(l.id, { requirements: [], laneAgents: [], roster, laneKey: l.key });

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

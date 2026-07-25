/**
 * Lane requirement gating — pillar 2 of the Agentic Workforce Kanban.
 *
 * When a ticket ENTERS a lane, enforce that lane's required REVIEWER checks (e.g.
 * "the Architect must have reviewed the implementation & PRD before Ready-for-Test").
 * If a required reviewer role has not signed off:
 *   • the ticket is flagged (the audit recompute does this), and
 *   • the responsible reviewer role's agent is dispatched to review and give
 *     feedback — the round-trip back to the Developer.
 *
 * Gate strictness (swimlanes.requirement_gate):
 *   'off'  → audit only (coverage recorded), never blocks or round-trips.
 *   'soft' → flag + dispatch the missing reviewer; that reviewer run takes this hop
 *            (the lane's normal agent runs once the ticket re-enters satisfied).
 *   'hard' → block the lane's normal auto-run until every required reviewer has
 *            signed off, even when no reviewer agent can be resolved (waits for a human).
 *
 * TWO SOURCES OF "WHO APPROVES THIS LANE". Requirement rows are the FIRST source, not
 * the only one: measured in production, 1 of 11 boards has any, so on the other 10 this
 * gate used to return `none` before reaching a single dispatch. The fallback is the
 * lane's STAFFING (`swimlane_agent_assignments`), resolved by the shared, documented
 * precedence in {@link resolveLaneApprovers} — see `laneApprover.ts` for the whole rule
 * and why the fall-through remains fail-closed. Both sources converge on the SAME
 * round-trip contract ({@link buildSignoffRequestPayload}), so a board with a template
 * and a board with only staffing produce the same accountability record.
 */
import { and, asc, eq } from 'drizzle-orm';
import {
  swimlaneAgentAssignments,
  swimlaneRequirements,
  swimlanes,
  tasks,
  ticketRoleSignoffs,
} from '../../infrastructure/database/schema';
import { requirementApplies } from '../kanban/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { TicketAuditService } from '../audit/ticketAuditService';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { normalizeRoleText } from '../kanban/roleMatch';
import { roleDisplayName } from '../kanban/roleCatalog';
import { resolveRoleCapableAgents } from '../kanban/roleCapability';
import { TicketParticipantsService } from '../kanban/ticketParticipants';
import { isParticipantSatisfied } from '../kanban/participantStates';
import { buildSignoffRequestPayload } from '../kanban/signoffRequest';
import { recordActivity, cloudAgentActor } from '../activity/activityLog';
import { findCanonicalBoard } from './canonicalBoard';
import { decideLaneAgentApproval, laneApprovalOwed, resolveLaneApprovers, type StaffedLaneApprover } from './laneApprover';

/** Emit the Coordinator hand-off signal: role R was dispatched to work the ticket. */
async function emitRoleDispatched(env: Env, db: Db, a: { tenantId: number; projectId: number; taskId: number; roleKey: string; roleName: string; agentRef: string; responsibility: 'reviewer' | 'producer' }): Promise<void> {
  await recordActivity(env, db, {
    tenantId: a.tenantId, projectId: a.projectId,
    actor: cloudAgentActor(a.agentRef, a.roleName),
    verb: 'ticket.role.dispatched',
    targetType: 'task', targetId: String(a.taskId), targetLabel: `#${a.taskId}`,
    summary: `${a.roleName} dispatched as ${a.responsibility} for ticket #${a.taskId}`.slice(0, 300),
    metadata: { roleKey: a.roleKey, responsibility: a.responsibility, agentRef: a.agentRef },
  }).catch(() => {});
}

export interface LaneGateOutcome {
  /** Suppress the lane's normal auto-run this hop (a reviewer round-trip or producer
   *  dispatch is owed, or a hard gate is unmet). */
  blocked: boolean;
  flagged: boolean;
  dispatchedReviewers: string[];
  /** Role-capable producers dispatched AS their role on a hard producer stage. */
  dispatchedProducers: string[];
}

// Display names come from the ONE resolver in `roleCatalog` (this module used to keep a
// private copy that returned the raw key for tenant-custom roles).
const roleName = roleDisplayName;

/** Resolve a runnable agent for a role: a staffed lane agent first, else the
 *  first ROLE-CAPABLE agent (explicit pin → role_keys → builtin_kind → fuzzy —
 *  the first-class capability resolver, superseding the old fuzzy-only match).
 *  Null when no agent can fill the role. */
async function resolveRoleAgent(env: Env, db: Db, tenantId: number, projectId: number, boardId: string, roleKey: string): Promise<string | null> {
  const nk = normalizeRoleText(roleKey);
  const staffed = await db
    .select({ agentRef: swimlaneAgentAssignments.agentRef, role: swimlaneAgentAssignments.role })
    .from(swimlaneAgentAssignments)
    .innerJoin(swimlanes, eq(swimlaneAgentAssignments.swimlaneId, swimlanes.id))
    .where(eq(swimlanes.boardId, boardId));
  for (const s of staffed) if (s.agentRef && normalizeRoleText(s.role) === nk) return s.agentRef;

  const [capable] = await resolveRoleCapableAgents(env, db, tenantId, projectId, roleKey);
  return capable?.ref ?? null;
}

/** A live run already owns this ticket — never pile a second one on top of it. */
async function hasLiveRun(runtimeService: RuntimeService, taskId: number): Promise<boolean> {
  const execs = await runtimeService.listByTask(taskId).catch(() => []);
  return execs
    .map((e) => e.toPlain())
    .some((e) => ['pending', 'submitted', 'running', 'paused'].includes(e.status));
}

/**
 * TIER (b) — approval driven by the lane's ASSIGNED AGENT, for the boards (10 of 11 in
 * production) that declare no `swimlane_requirements` rows at all.
 *
 * Three properties make this safe to run on every lane entry of every un-templated
 * board:
 *
 *  1. IT NEVER PREEMPTS THE WORK. The approval is owed only once the lane's work has
 *     actually run — which the manifest records for us, because `attributeRunToManifest`
 *     advances the slot to `in_progress` when a run for that role/stage finalizes. While
 *     the slot is still `assigned` this returns a non-blocking outcome so the lane's
 *     NORMAL agent runs first. Dispatching a reviewer before the work exists would have
 *     replaced implementation with a review on all 10 boards — a regression far worse
 *     than the missing sign-off.
 *  2. IT ALWAYS LEAVES A SLOT BEHIND. The required participant is materialised even when
 *     nothing is dispatched, so `decideSignoffGate` has a real, named thing to wait for
 *     instead of an empty manifest, and the AI Manager's `driveOutstandingSignoffs` can
 *     drive the same slot from the review lane.
 *  3. IT FAILS CLOSED. No resolvable approver ⇒ no slot, no dispatch, no block — and an
 *     empty manifest keeps `decideSignoffGate` shut. Absence of an approver is never
 *     treated as approval.
 *
 * Best-effort throughout (the caller's contract): every step swallows its own failure.
 */
async function enforceLaneAgentApproval(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  participants: TicketParticipantsService,
  args: { tenantId: number; projectId: number; taskId: number; status: string; submittedBy: string; taskTitle: string | null },
  lane: { id: string; requirementGate: string; isTerminal: boolean },
): Promise<LaneGateOutcome> {
  const none: LaneGateOutcome = { blocked: false, flagged: false, dispatchedReviewers: [], dispatchedProducers: [] };
  // A terminal (Done) lane has nothing left to approve — the ticket is finalized, and a
  // review run dispatched here could only burn tokens on a decision nobody can act on.
  if (lane.isTerminal) return none;

  // ONE resolver, shared with the manager and the managed-execution guard. Passing no
  // requirement refs is what selects tier (b); it is the caller's job to have already
  // established that tier (a) is empty for THIS ticket.
  const decision = await resolveLaneApprovers(db, { tenantId: args.tenantId, swimlaneId: lane.id, requirementRoleKeys: [] })
    .catch(() => null);
  if (!decision?.approverResolved) return none;

  // Materialise the required reviewer slot(s) — idempotent on the slot unique index
  // (taskId, stageKey, roleKey, responsibility, source), so re-entering the lane upserts
  // rather than duplicating. `reviewer` responsibility is deliberate: a reviewer slot
  // completes only on a recorded VERDICT, whereas an owner/contributor slot completes on
  // a run with PR evidence — and the point here is the sign-off, not the delivery.
  const approvers = decision.approvers.flatMap((a): StaffedLaneApprover[] =>
    a.agentRef ? [{ ...a, agentRef: a.agentRef }] : []);
  for (const approver of approvers) {
    await participants.addParticipant(env, args.tenantId, args.taskId, {
      roleKey: approver.roleKey,
      responsibility: 'reviewer',
      stageKey: args.status,
      source: 'lane_agent',
      assignee: { kind: 'agent', ref: approver.agentRef, name: approver.agentName ?? approver.agentRef },
      note: `Lane '${args.status}' declares no role requirements — its assigned agent ${approver.agentName ?? approver.agentRef} is accountable for sign-off as ${approver.roleName}.`,
    }).catch(() => null);
  }

  const manifest = await participants.listParticipants(env, args.tenantId, args.taskId).catch(() => []);
  const stateByRole = new Map(manifest.filter((p) => p.stageKey === args.status).map((p) => [p.roleKey, p.state]));

  // Cheap pre-check on the SAME shared rule the full decision applies, so the common case
  // (the lane's work has not run yet) costs nothing extra — this path is reached on nearly
  // every lane entry, and the two queries below are only worth paying for once an approval
  // is genuinely outstanding.
  if (laneApprovalOwed(approvers, stateByRole).length === 0) return none;

  // Roles that have ALREADY recorded any verdict, and whether a run already owns the
  // ticket — the two loop/idempotency guards the decision needs.
  const answered = new Set(
    (await db
      .select({ roleKey: ticketRoleSignoffs.roleKey })
      .from(ticketRoleSignoffs)
      .where(eq(ticketRoleSignoffs.taskId, args.taskId))
      .catch(() => []))
      .map((v) => v.roleKey),
  );
  const decided = decideLaneAgentApproval({
    approvers,
    stateByRole,
    answered,
    hasLiveRun: await hasLiveRun(runtimeService, args.taskId),
    requirementGate: lane.requirementGate,
  });
  if (decided.owed.length === 0) return none;

  const dispatchedReviewers: string[] = [];
  if (decided.ask) {
    const approver = decided.ask;
    const payload = buildSignoffRequestPayload({
      cloudAgentRef: approver.agentRef,
      model: approver.model,
      taskId: args.taskId,
      taskTitle: args.taskTitle,
      roleKey: approver.roleKey,
      roleName: approver.roleName,
      laneKey: args.status,
    });
    const deferred: Promise<unknown>[] = [];
    const execId = await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
      taskId: args.taskId,
      tenantId: args.tenantId,
      payload,
      submittedBy: `${args.submittedBy}:lane-approver:${approver.roleKey}`,
    }).catch(() => null);
    await Promise.allSettled(deferred);
    if (execId != null) {
      await participants.markRoleInProgress(env, args.tenantId, args.taskId, approver.roleKey, args.status, execId).catch(() => {});
      await emitRoleDispatched(env, db, {
        tenantId: args.tenantId, projectId: args.projectId, taskId: args.taskId,
        roleKey: approver.roleKey, roleName: approver.roleName, agentRef: approver.agentRef, responsibility: 'reviewer',
      });
      dispatchedReviewers.push(approver.roleKey);
    }
  }

  return {
    // A dispatch that failed to produce an execution must not suppress the lane's normal
    // agent — only a real in-flight approval run (or an unmet 'hard' gate) does.
    blocked: dispatchedReviewers.length > 0 || (decided.blocked && !decided.ask),
    flagged: decided.flagged,
    dispatchedReviewers,
    dispatchedProducers: [],
  };
}

/**
 * Enforce the current lane's required reviewer checks. Always recomputes the
 * ticket audit (making coverage live). Returns whether the lane's normal auto-run
 * should be suppressed this hop and which reviewer agents were dispatched.
 */
export async function enforceLaneRequirements(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  auditService: TicketAuditService,
  args: { tenantId: number; projectId: number; taskId: number; status: string; submittedBy: string },
): Promise<LaneGateOutcome> {
  const none: LaneGateOutcome = { blocked: false, flagged: false, dispatchedReviewers: [], dispatchedProducers: [] };
  const participants = new TicketParticipantsService(db);
  try {
    const board = await findCanonicalBoard(db, args.projectId, args.tenantId);
    if (!board) return none;
    const [lane] = await db
      .select({ id: swimlanes.id, requirementGate: swimlanes.requirementGate, isTerminal: swimlanes.isTerminal })
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.key, args.status)))
      .limit(1);
    if (!lane) return none;

    // Always compute the audit so entering any lane refreshes coverage / the flag.
    await auditService.computeAudit(env, args.tenantId, args.taskId).catch(() => {});

    if (lane.requirementGate === 'off') return none;

    // Requirements on THIS lane, scoped to the ticket's type/condition (a Security
    // ticket requires the security role; a docs ticket doesn't require QA).
    const [taskRow] = await db.select({ title: tasks.title, taskType: tasks.taskType, actionType: tasks.actionType }).from(tasks).where(eq(tasks.id, args.taskId)).limit(1);
    const allReqRows = await db
      .select({ kind: swimlaneRequirements.kind, ref: swimlaneRequirements.ref, responsibility: swimlaneRequirements.responsibility, isRequired: swimlaneRequirements.isRequired, ticketType: swimlaneRequirements.ticketType, condition: swimlaneRequirements.condition, quorum: swimlaneRequirements.quorum })
      .from(swimlaneRequirements)
      .where(eq(swimlaneRequirements.swimlaneId, lane.id))
      .orderBy(asc(swimlaneRequirements.position));
    const reqRows = allReqRows.filter((r) => requirementApplies({ ticketType: r.ticketType, condition: r.condition }, { taskType: taskRow?.taskType ?? null, actionType: taskRow?.actionType ?? null }));
    const requiredReviewers = reqRows.filter(
      (r) => r.isRequired && (r.kind === 'review' || (r.kind === 'role' && r.responsibility === 'reviewer')),
    );
    // Reviewer quorum for this lane: smallest declared quorum, capped at the set size;
    // default = the set size (all reviewers must approve — the legacy rule).
    const declaredQuorums = requiredReviewers.map((r) => r.quorum).filter((q): q is number => typeof q === 'number' && q > 0);
    const reviewerQuorum = Math.min(requiredReviewers.length || 1, declaredQuorums.length ? Math.min(...declaredQuorums) : (requiredReviewers.length || 1));
    // Producers = required role requirements a role must PRODUCE (owner/contributor,
    // or a bare role which we treat as owner). Now first-class gating (past reviewers).
    const requiredProducers = reqRows.filter(
      (r) => r.isRequired && r.kind === 'role' && (r.responsibility == null || r.responsibility === 'owner' || r.responsibility === 'contributor'),
    );
    // TIER (b): this lane declares nothing that applies to this ticket. Rather than the
    // old unconditional `return none` — which is why 10 of 11 boards never produced a
    // single sign-off — fall through to the lane's ASSIGNED AGENT as the approver.
    if (requiredReviewers.length === 0 && requiredProducers.length === 0) {
      return await enforceLaneAgentApproval(env, db, runtimeService, participants, {
        ...args, taskTitle: taskRow?.title ?? null,
      }, lane);
    }

    // Reviewer sign-off state (latest verdict per role).
    const signoffs = await db
      .select({ roleKey: ticketRoleSignoffs.roleKey, verdict: ticketRoleSignoffs.verdict, createdAt: ticketRoleSignoffs.createdAt })
      .from(ticketRoleSignoffs)
      .where(eq(ticketRoleSignoffs.taskId, args.taskId))
      .orderBy(asc(ticketRoleSignoffs.createdAt));
    const latest = new Map<string, string>();
    for (const s of signoffs) latest.set(s.roleKey, s.verdict);

    // Live-run guard: never pile up runs — if one is in flight, only flag this hop.
    const hasLive = await hasLiveRun(runtimeService, args.taskId);

    const dispatchedReviewers: string[] = [];
    const dispatchedProducers: string[] = [];

    // ── Reviewers (quorum-aware round-trip) ─────────────────────────────────
    // The reviewer SET is met once `reviewerQuorum` approvals land (2-of-3 advances on
    // the 2nd approval, not the 1st). To-dispatch = reviewers NEVER engaged (no verdict
    // row) — once a reviewer records any verdict we stop re-dispatching it, so repeated
    // lane entries can't spawn an endless reviewer loop.
    const approvedReviewers = requiredReviewers.filter((r) => latest.get(r.ref) === 'approved').length;
    const reviewerSetUnmet = requiredReviewers.length > 0 && approvedReviewers < reviewerQuorum;
    if (reviewerSetUnmet && !hasLive) {
      const toDispatch = requiredReviewers.filter((r) => !latest.has(r.ref));
      for (const req of toDispatch) {
        const agentRef = await resolveRoleAgent(env, db, args.tenantId, args.projectId, board.id, req.ref);
        if (!agentRef) continue;
        // ONE shared request contract with the lane-agent path and the AI Manager. The
        // hand-written string this replaced never told the agent to pass `laneKey`, so
        // its verdict landed in the ledger keyed to no lane and matched no manifest slot
        // — see `kanban/signoffRequest.ts`.
        const payload = buildSignoffRequestPayload({
          cloudAgentRef: agentRef,
          taskId: args.taskId,
          taskTitle: taskRow?.title ?? null,
          roleKey: req.ref,
          roleName: roleName(req.ref),
          laneKey: args.status,
        });
        const deferred: Promise<unknown>[] = [];
        const execId = await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
          taskId: args.taskId,
          tenantId: args.tenantId,
          payload,
          submittedBy: `${args.submittedBy}:reviewer:${req.ref}`,
        }).catch(() => null);
        await Promise.allSettled(deferred);
        // Attribution (§5.6): record the reviewer is now engaged (execution-linked).
        if (execId != null) await participants.markRoleInProgress(env, args.tenantId, args.taskId, req.ref, args.status, execId).catch(() => {});
        await emitRoleDispatched(env, db, { tenantId: args.tenantId, projectId: args.projectId, taskId: args.taskId, roleKey: req.ref, roleName: roleName(req.ref), agentRef, responsibility: 'reviewer' });
        dispatchedReviewers.push(req.ref);
        break; // one reviewer per hop — keeps the round-trip serial and loop-safe
      }
    }

    // ── Producers ───────────────────────────────────────────────────────────
    // Dispatch the ROLE-CAPABLE producer AS the role when the producer stage isn't
    // engaged yet, so the correct role produces the work (not a wrong-role owner or
    // nothing). Loop-safe: an in_progress/completed producer slot is never re-dispatched.
    let producerUnmet = false;
    if (requiredProducers.length > 0) {
      const manifest = await participants.listParticipants(env, args.tenantId, args.taskId).catch(() => []);
      const stateByRole = new Map(manifest.filter((p) => p.stageKey === args.status).map((p) => [p.roleKey, p.state]));
      for (const req of requiredProducers) {
        const st = stateByRole.get(req.ref);
        if (st && isParticipantSatisfied(st)) continue;
        producerUnmet = true;
        const canDispatch = !hasLive && dispatchedReviewers.length === 0 && dispatchedProducers.length === 0 && st !== 'in_progress';
        if (!canDispatch) continue;
        const agentRef = await resolveRoleAgent(env, db, args.tenantId, args.projectId, board.id, req.ref);
        if (!agentRef) continue;
        const payload = JSON.stringify({
          cloudAgentRef: agentRef,
          laneKey: args.status,
          actAsRole: req.ref,
          reviewInstruction:
            `You are the ${roleName(req.ref)} assigned to PRODUCE the work for ticket #${args.taskId} at lane '${args.status}'. ` +
            `Implement/author the required deliverable (open a PR for code, or write the PRD section for a spec role). ` +
            `Your run is recorded as this role's participation on the accountability manifest. ` +
            `When the deliverable is complete, record a role-attributed sign-off for lane '${args.status}' with contribution evidence.`,
        });
        const deferred: Promise<unknown>[] = [];
        const execId = await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
          taskId: args.taskId,
          tenantId: args.tenantId,
          payload,
          submittedBy: `${args.submittedBy}:producer:${req.ref}`,
        }).catch(() => null);
        await Promise.allSettled(deferred);
        if (execId != null) await participants.markRoleInProgress(env, args.tenantId, args.taskId, req.ref, args.status, execId).catch(() => {});
        await emitRoleDispatched(env, db, { tenantId: args.tenantId, projectId: args.projectId, taskId: args.taskId, roleKey: req.ref, roleName: roleName(req.ref), agentRef, responsibility: 'producer' });
        dispatchedProducers.push(req.ref);
      }
    }

    if (dispatchedReviewers.length === 0 && dispatchedProducers.length === 0 && !reviewerSetUnmet && !producerUnmet) return none;

    // Block the lane's normal agent when a role round-trip is owed (dispatched this hop)
    // OR a hard gate is unmet (reviewer quorum short / producer not completed).
    const blocked = dispatchedReviewers.length > 0 || dispatchedProducers.length > 0
      // A managed ticket never falls through to a generic lane executor while its
      // named producer is outstanding, even when the stage's advancement gate is soft.
      || (board.lifecycleManaged && producerUnmet)
      || (lane.requirementGate === 'hard' && (reviewerSetUnmet || producerUnmet));
    return { blocked, flagged: reviewerSetUnmet || producerUnmet, dispatchedReviewers, dispatchedProducers };
  } catch {
    return none;
  }
}

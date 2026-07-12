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
 */
import { and, asc, eq } from 'drizzle-orm';
import {
  boards,
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
import { BUILTIN_ROLES } from '../kanban/roleCatalog';
import { resolveRoleCapableAgents } from '../kanban/roleCapability';
import { TicketParticipantsService } from '../kanban/ticketParticipants';
import { recordActivity, cloudAgentActor } from '../activity/activityLog';

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

const roleName = (key: string): string => BUILTIN_ROLES.find((r) => r.key === key)?.name ?? key;

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
    const [board] = await db.select({ id: boards.id }).from(boards).where(eq(boards.projectId, args.projectId)).limit(1);
    if (!board) return none;
    const [lane] = await db
      .select({ id: swimlanes.id, requirementGate: swimlanes.requirementGate })
      .from(swimlanes)
      .where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.key, args.status)))
      .limit(1);
    if (!lane) return none;

    // Always compute the audit so entering any lane refreshes coverage / the flag.
    await auditService.computeAudit(env, args.tenantId, args.taskId).catch(() => {});

    if (lane.requirementGate === 'off') return none;

    // Requirements on THIS lane, scoped to the ticket's type/condition (a Security
    // ticket requires the security role; a docs ticket doesn't require QA).
    const [taskRow] = await db.select({ taskType: tasks.taskType, actionType: tasks.actionType }).from(tasks).where(eq(tasks.id, args.taskId)).limit(1);
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
    if (requiredReviewers.length === 0 && requiredProducers.length === 0) return none;

    // Reviewer sign-off state (latest verdict per role).
    const signoffs = await db
      .select({ roleKey: ticketRoleSignoffs.roleKey, verdict: ticketRoleSignoffs.verdict, createdAt: ticketRoleSignoffs.createdAt })
      .from(ticketRoleSignoffs)
      .where(eq(ticketRoleSignoffs.taskId, args.taskId))
      .orderBy(asc(ticketRoleSignoffs.createdAt));
    const latest = new Map<string, string>();
    for (const s of signoffs) latest.set(s.roleKey, s.verdict);

    // Live-run guard: never pile up runs — if one is in flight, only flag this hop.
    const execs = await runtimeService.listByTask(args.taskId).catch(() => []);
    const hasLive = execs
      .map((e) => e.toPlain())
      .some((e) => ['pending', 'submitted', 'running', 'paused'].includes(e.status));

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
        const payload = JSON.stringify({
          cloudAgentRef: agentRef,
          laneKey: args.status,
          reviewRole: req.ref,
          reviewInstruction:
            `You are the ${roleName(req.ref)} reviewing ticket #${args.taskId} at lane '${args.status}'. ` +
            `Review the implementation against the PRD and acceptance criteria, then record your sign-off ` +
            `(POST /api/kanban/tasks/${args.taskId}/signoff with roleKey='${req.ref}', verdict 'approved' or 'changes_requested'). ` +
            `If you request changes, describe the fixes for the Developer to resolve.`,
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

    // ── Producers (hard stages only — opt-in strictness, FR-3) ──────────────
    // Dispatch the ROLE-CAPABLE producer AS the role when the producer stage isn't
    // engaged yet, so the correct role produces the work (not a wrong-role owner or
    // nothing). Loop-safe: an in_progress/completed producer slot is never re-dispatched.
    let producerUnmet = false;
    if (lane.requirementGate === 'hard' && requiredProducers.length > 0) {
      const manifest = await participants.listParticipants(env, args.tenantId, args.taskId).catch(() => []);
      const stateByRole = new Map(manifest.filter((p) => p.stageKey === args.status).map((p) => [p.roleKey, p.state]));
      const done = new Set(['completed', 'waived', 'skipped']);
      for (const req of requiredProducers) {
        const st = stateByRole.get(req.ref);
        if (st && done.has(st)) continue;
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
            `Your run is recorded as this role's participation on the accountability manifest.`,
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
      || (lane.requirementGate === 'hard' && (reviewerSetUnmet || producerUnmet));
    return { blocked, flagged: reviewerSetUnmet || producerUnmet, dispatchedReviewers, dispatchedProducers };
  } catch {
    return none;
  }
}

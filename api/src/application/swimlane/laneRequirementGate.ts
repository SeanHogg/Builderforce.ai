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
  ideAgents,
  swimlaneAgentAssignments,
  swimlaneRequirements,
  swimlanes,
  ticketRoleSignoffs,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { TicketAuditService } from '../audit/ticketAuditService';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { agentMatchesRole, normalizeRoleText } from '../kanban/roleMatch';
import { BUILTIN_ROLES } from '../kanban/roleCatalog';

export interface LaneGateOutcome {
  /** Suppress the lane's normal auto-run this hop (a reviewer round-trip is owed). */
  blocked: boolean;
  flagged: boolean;
  dispatchedReviewers: string[];
}

const roleName = (key: string): string => BUILTIN_ROLES.find((r) => r.key === key)?.name ?? key;

/** Resolve a runnable agent for a role: a staffed lane agent first, else a tenant
 *  agent whose title/skills match. Null when no agent can fill the role. */
async function resolveRoleAgent(db: Db, tenantId: number, boardId: string, roleKey: string): Promise<string | null> {
  const nk = normalizeRoleText(roleKey);
  const staffed = await db
    .select({ agentRef: swimlaneAgentAssignments.agentRef, role: swimlaneAgentAssignments.role })
    .from(swimlaneAgentAssignments)
    .innerJoin(swimlanes, eq(swimlaneAgentAssignments.swimlaneId, swimlanes.id))
    .where(eq(swimlanes.boardId, boardId));
  for (const s of staffed) if (s.agentRef && normalizeRoleText(s.role) === nk) return s.agentRef;

  const agents = await db
    .select({ id: ideAgents.id, name: ideAgents.name, title: ideAgents.title, skills: ideAgents.skills })
    .from(ideAgents)
    .where(eq(ideAgents.tenantId, tenantId));
  for (const a of agents) if (agentMatchesRole(a, roleKey, roleName(roleKey))) return a.id;
  return null;
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
  const none: LaneGateOutcome = { blocked: false, flagged: false, dispatchedReviewers: [] };
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

    // Required reviewer requirements on THIS lane.
    const reqRows = await db
      .select({ kind: swimlaneRequirements.kind, ref: swimlaneRequirements.ref, responsibility: swimlaneRequirements.responsibility, isRequired: swimlaneRequirements.isRequired })
      .from(swimlaneRequirements)
      .where(eq(swimlaneRequirements.swimlaneId, lane.id))
      .orderBy(asc(swimlaneRequirements.position));
    const requiredReviewers = reqRows.filter(
      (r) => r.isRequired && (r.kind === 'review' || (r.kind === 'role' && r.responsibility === 'reviewer')),
    );
    if (requiredReviewers.length === 0) return none;

    // Which reviewer roles have an approving sign-off already?
    const signoffs = await db
      .select({ roleKey: ticketRoleSignoffs.roleKey, verdict: ticketRoleSignoffs.verdict, createdAt: ticketRoleSignoffs.createdAt })
      .from(ticketRoleSignoffs)
      .where(eq(ticketRoleSignoffs.taskId, args.taskId))
      .orderBy(asc(ticketRoleSignoffs.createdAt));
    const latest = new Map<string, string>();
    for (const s of signoffs) latest.set(s.roleKey, s.verdict);
    const missing = requiredReviewers.filter((r) => latest.get(r.ref) !== 'approved');
    if (missing.length === 0) return none;

    // Dispatch the missing reviewer role agents (round-trip). Guard against piling
    // up runs: if a live run already exists on the ticket, only flag this hop.
    const execs = await runtimeService.listByTask(args.taskId).catch(() => []);
    const hasLive = execs
      .map((e) => e.toPlain())
      .some((e) => ['pending', 'submitted', 'running', 'paused'].includes(e.status));

    const dispatchedReviewers: string[] = [];
    if (!hasLive) {
      for (const req of missing) {
        const agentRef = await resolveRoleAgent(db, args.tenantId, board.id, req.ref);
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
        await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
          taskId: args.taskId,
          tenantId: args.tenantId,
          payload,
          submittedBy: `${args.submittedBy}:reviewer:${req.ref}`,
        }).catch(() => {});
        await Promise.allSettled(deferred);
        dispatchedReviewers.push(req.ref);
        break; // one reviewer per hop — keeps the round-trip serial and loop-safe
      }
    }

    // Block the lane's normal agent when a reviewer round-trip is owed: a reviewer
    // was dispatched this hop, OR the gate is 'hard' and the requirement is unmet.
    const blocked = dispatchedReviewers.length > 0 || lane.requirementGate === 'hard';
    return { blocked, flagged: true, dispatchedReviewers };
  } catch {
    return none;
  }
}

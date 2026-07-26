/**
 * Attribute a finalized run to the role it ran AS on the ticket's participation
 * manifest (PRD-coordinated-role-participation.md §5.6). Wired at the composition
 * root to `RuntimeService.onRunFinalized`, so every terminal cloud run records that
 * "role X participated" — linked to the execution — and, for a PRODUCER with PR
 * evidence, completes that role's manifest slot (the completion signal producer
 * gating needs). Best-effort by contract: never throws, never blocks the run.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { pullRequests, swimlaneRequirements, swimlanes, tasks } from '../../infrastructure/database/schema';
import { TicketParticipantsService } from './ticketParticipants';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { producerRoleForActionType } from './roleCapability';

export interface RunFinalizedInfo {
  tenantId: number;
  taskId: number;
  projectId: number;
  executionId: number;
  status: 'completed' | 'failed';
  /** The role the run ran AS, from its payload (reviewRole/actAsRole), if any. */
  actAsRole: string | null;
  /** The lane the run served (its producer stage), if known. */
  laneServed: string | null;
}

/** The required PRODUCER role (owner/contributor) of a lane, if it declares one. */
async function producerRoleOfLane(db: Db, projectId: number, laneKey: string): Promise<string | null> {
  const board = await findCanonicalBoard(db, projectId);
  if (!board) return null;
  const [lane] = await db.select({ id: swimlanes.id }).from(swimlanes).where(and(eq(swimlanes.boardId, board.id), eq(swimlanes.key, laneKey))).limit(1);
  if (!lane) return null;
  const rows = await db
    .select({ ref: swimlaneRequirements.ref, responsibility: swimlaneRequirements.responsibility })
    .from(swimlaneRequirements)
    .where(and(eq(swimlaneRequirements.swimlaneId, lane.id), eq(swimlaneRequirements.kind, 'role')))
    .orderBy(asc(swimlaneRequirements.position));
  const producer = rows.find((r) => r.responsibility == null || r.responsibility === 'owner' || r.responsibility === 'contributor');
  return producer?.ref ?? null;
}

/**
 * Last-resort producer role, derived from the ticket's own `action_type`.
 *
 * WHY THIS FALLBACK EXISTS — it is the fix for a total, silent failure of the whole
 * accountability loop. Role resolution used to come ONLY from `swimlane_requirements`,
 * and in practice almost no board has those rows configured (measured: 1 of 11 boards).
 * With no role resolved, `attributeRunToManifest` returned early, so no completed run
 * was ever attributed, no manifest slot ever left `assigned`, and `ticket_role_signoffs`
 * stayed EMPTY across the entire tenant — 487 required slots, 0 satisfied. Every
 * sign-off-based gate downstream was therefore unsatisfiable by construction.
 *
 * `producerRoleForActionType` already maps the work's technical shape to the role that
 * does it (sql/frontend_ui/backend_api/refactor/bugfix → developer, tests → qa-tester,
 * docs → tech-writer, devops_ci → devops), so a ticket earns producer credit from the
 * work it actually is, with no board configuration required.
 */
async function producerRoleFromActionType(db: Db, taskId: number): Promise<string | null> {
  const [row] = await db.select({ actionType: tasks.actionType }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return producerRoleForActionType(row?.actionType) ?? null;
}

/** Latest non-draft PR URL for a task (the producer completion evidence), or null. */
async function taskPrEvidence(db: Db, tenantId: number, taskId: number): Promise<string | null> {
  const [pr] = await db
    .select({ url: pullRequests.url, status: pullRequests.status })
    .from(pullRequests)
    .where(and(eq(pullRequests.tenantId, tenantId), eq(pullRequests.taskId, taskId)))
    .orderBy(desc(pullRequests.createdAt))
    .limit(1);
  if (!pr || pr.status === 'draft') return null;
  return pr.url ?? `pr:task-${taskId}`;
}

export async function attributeRunToManifest(env: Env, db: Db, info: RunFinalizedInfo): Promise<void> {
  try {
    // A failed run attributes nothing (no participation credit for a failed attempt).
    if (info.status !== 'completed') return;
    // Resolve the role three ways, most-specific first: the role the run explicitly ran
    // AS, then the lane's declared producer requirement, then the ticket's action_type.
    // The third tier is what makes this work on a board with no requirements configured
    // — without it this function silently no-opped for essentially every ticket.
    const roleKey = info.actAsRole
      ?? (info.laneServed ? await producerRoleOfLane(db, info.projectId, info.laneServed) : null)
      ?? await producerRoleFromActionType(db, info.taskId);
    if (!roleKey) return;
    const prUrl = await taskPrEvidence(db, info.tenantId, info.taskId);
    const participants = new TicketParticipantsService(db);
    await participants.recordRunAttribution(env, info.tenantId, info.taskId, {
      roleKey,
      stageKey: info.laneServed,
      executionId: info.executionId,
      ...(prUrl ? { prUrl } : {}),
    });
  } catch (error) { /* best-effort: attribution must never break the run */ 
    console.error('[suppressed-error] application/kanban/attributeRunToManifest.ts:97 attributeRunToManifest', { error });
  }
}

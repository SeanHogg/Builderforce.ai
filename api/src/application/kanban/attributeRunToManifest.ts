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
import { boards, pullRequests, swimlaneRequirements, swimlanes } from '../../infrastructure/database/schema';
import { TicketParticipantsService } from './ticketParticipants';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';

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
    const roleKey = info.actAsRole ?? (info.laneServed ? await producerRoleOfLane(db, info.projectId, info.laneServed) : null);
    if (!roleKey) return;
    const prUrl = await taskPrEvidence(db, info.tenantId, info.taskId);
    const participants = new TicketParticipantsService(db);
    await participants.recordRunAttribution(env, info.tenantId, info.taskId, {
      roleKey,
      stageKey: info.laneServed,
      executionId: info.executionId,
      ...(prUrl ? { prUrl } : {}),
    });
  } catch { /* best-effort: attribution must never break the run */ }
}

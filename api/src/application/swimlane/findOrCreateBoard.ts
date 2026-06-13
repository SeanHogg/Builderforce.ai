import { and, asc, eq } from 'drizzle-orm';
import { boards, swimlanes } from '../../infrastructure/database/schema';
import { DEFAULT_SWIMLANES } from './defaultSwimlanes';
import type { Db } from '../../infrastructure/database/connection';

type Board = typeof boards.$inferSelect;

export interface FindOrCreateBoardInput {
  tenantId: number;
  projectId: number;
  name: string;
  segmentId?: string | null;
  maxConcurrentTickets?: number;
  needsAttentionLane?: string;
  /** Seed the standard status-mirroring swimlanes on first creation (default true). */
  seedDefaultLanes?: boolean;
}

export interface FindOrCreateBoardResult {
  board: Board;
  /** true when a new board row was inserted; false when an existing one was returned. */
  created: boolean;
}

/**
 * Build the insert rows for a board's default status-mirroring swimlanes. Shared
 * by the create path (seed on first creation) and the ensure-defaults heal route
 * so the two can never drift apart.
 */
export function buildDefaultLaneRows(
  tenantId: number,
  segmentId: string | null,
  boardId: string,
  now: Date,
) {
  return DEFAULT_SWIMLANES.map((l) => ({
    tenantId,
    segmentId,
    boardId,
    key: l.key,
    name: l.name,
    position: l.position,
    isTerminal: l.isTerminal,
    gate: l.gate,
    executionMode: 'sequential',
    failurePolicy: 'needs_attention',
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Find-or-create the single board for a project, enforcing the
 * one-board-per-project invariant (UNIQUE(project_id), migration 0111) in code
 * so both create entry points (the REST `POST /api/boards` and the Brain
 * `boards.create` action, which itself calls that endpoint) converge here rather
 * than blindly inserting a duplicate.
 *
 * Existing-board check is by `projectId` only — that mirrors the DB constraint
 * (which is keyed on `project_id` alone, since a project already belongs to one
 * tenant) so a UNIQUE violation can never surface to the caller.
 *
 * On first creation, the board + its default swimlanes must be created together:
 * a failure after the board insert but before the lane seed leaves a
 * permanently-empty board (the kanban renders its hardcoded default columns, but
 * the config panel reports "No swimlanes yet"). The Neon HTTP driver has no
 * transaction support, so we enforce the board-with-lanes invariant with a
 * compensating delete: if the lane seed fails, roll the board back so we never
 * leave the half-created state.
 */
export async function findOrCreateBoard(
  db: Db,
  input: FindOrCreateBoardInput,
): Promise<FindOrCreateBoardResult> {
  const segmentId = input.segmentId ?? null;

  // Prefer the earliest board so callers agree on *which* board when a project
  // already (legacy) holds more than one — same tiebreak as `GET /api/boards`.
  const [existing] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.tenantId, input.tenantId), eq(boards.projectId, input.projectId)))
    .orderBy(asc(boards.createdAt), asc(boards.id))
    .limit(1);
  if (existing) return { board: existing, created: false };

  const now = new Date();
  const seedLanes = input.seedDefaultLanes !== false;

  const [created] = await db
    .insert(boards)
    .values({
      tenantId: input.tenantId,
      segmentId,
      projectId: input.projectId,
      name: input.name.trim(),
      // Autonomy is implicit (driven by lane agents + gate); no board toggle.
      autonomous: true,
      maxConcurrentTickets: input.maxConcurrentTickets ?? 5,
      needsAttentionLane: input.needsAttentionLane ?? 'needs-attention',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    // The insert returned no row (should never happen on a successful insert) —
    // surface it rather than returning an undefined board.
    throw new Error('findOrCreateBoard: board insert returned no row');
  }

  if (seedLanes) {
    try {
      await db.insert(swimlanes).values(buildDefaultLaneRows(input.tenantId, segmentId, created.id, now));
    } catch (e) {
      // Lane seed failed — roll the board back so no empty board lingers.
      await db.delete(boards).where(eq(boards.id, created.id)).catch(() => { /* best-effort */ });
      throw e;
    }
  }

  return { board: created, created: true };
}

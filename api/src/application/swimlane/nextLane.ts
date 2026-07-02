/**
 * nextLane — resolve the swimlane a ticket advances INTO when the current stage
 * completes, driven by the board's configured lane ORDER (`swimlanes.position`)
 * rather than a hardcoded status constant.
 *
 * This is what makes "an agent finishes → the ticket moves to the next swimlane"
 * honour a custom board (renamed / re-ordered lanes), instead of always jumping to
 * `in_review`. The pure {@link resolveNextLaneKey} is unit-tested without a DB; the
 * thin {@link resolveNextTaskStatus} wires it to the board's lanes for
 * RuntimeService's completion transition.
 */
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { boards, swimlanes } from '../../infrastructure/database/schema';

/** Minimal lane shape the ordering needs. */
export interface LanePosition {
  key: string;
  position: number;
  /** Whether this lane finalizes the ticket (a Done/terminal lane). */
  isTerminal?: boolean;
}

/**
 * The key of the lane immediately after `fromStatus` in board order, or null when
 * the current lane isn't found, it's already the last lane, OR the next lane is
 * TERMINAL. Sorted by position (ascending) so the caller can pass lanes in any
 * order.
 *
 * We deliberately do NOT auto-advance into a terminal (Done) lane: completing the
 * last WORKING lane leaves the ticket resting for review, exactly as before —
 * reaching Done stays an explicit act (a human move, or the `[auto-approve]`
 * governance token) so the Done finalize (commit + PR) isn't silently skipped.
 * This fix is about honouring the configured order of the WORKING lanes.
 */
export function resolveNextLaneKey(lanes: LanePosition[], fromStatus: string): string | null {
  const sorted = [...lanes].sort((a, b) => a.position - b.position);
  const idx = sorted.findIndex((l) => l.key === fromStatus);
  if (idx === -1) return null;
  const next = sorted[idx + 1];
  if (!next || next.isTerminal) return null;
  return next.key;
}

/**
 * Resolve the next-lane STATUS key for a task's project board. Returns null when
 * the project has no board or the current status doesn't map to a lane (a non-board
 * task) — the caller then keeps its default (in_review) so nothing regresses.
 *
 * Two indexed reads on the (low-frequency) execution-completion path — not a
 * per-request hot path — so it is read uncached, matching how evaluateTaskAutoRun
 * resolves the same lanes.
 */
export async function resolveNextTaskStatus(db: Db, projectId: number, fromStatus: string): Promise<string | null> {
  const [board] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.projectId, projectId))
    .limit(1);
  if (!board) return null;

  const lanes = await db
    .select({ key: swimlanes.key, position: swimlanes.position, isTerminal: swimlanes.isTerminal })
    .from(swimlanes)
    .where(eq(swimlanes.boardId, board.id))
    .orderBy(asc(swimlanes.position));

  return resolveNextLaneKey(lanes, fromStatus);
}

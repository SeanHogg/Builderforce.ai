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
import { findCanonicalBoard } from './canonicalBoard';

/** Minimal lane shape the ordering needs. */
export interface LanePosition {
  key: string;
  position: number;
  /** Whether this lane finalizes the ticket (a Done/terminal lane). */
  isTerminal?: boolean;
}

/**
 * Lane keys that are PARKED — off the delivery path — rather than a stage work flows
 * through.
 *
 * `swimlanes` has `is_terminal` but no flag for this, and the omission was load-bearing:
 * the default seed AND the SDLC template both place `blocked` at position 5, i.e. between
 * `in_review` (4) and `done` (6). Because {@link resolveNextLaneKey} walked raw positions,
 * a run completing in review advanced the ticket INTO `blocked` — measured on 10 of 13
 * production boards, 20 system moves across 19 tickets.
 *
 * That is a one-way trap, not a delay: `autonomousExecutionSweep.RUNNABLE_STATUSES`
 * deliberately excludes `blocked` ("a blocked ticket waits on a dependency, not an
 * agent"), so from the moment autonomy put a ticket there, autonomy would never look at
 * it again. Only a human drag could rescue it.
 *
 * Skipping these lanes when resolving the NEXT lane is the fix. It does not stop a human
 * (or a rule) from deliberately moving a ticket to `blocked` — it stops completion from
 * doing so by accident, which is the only path that was ever creating them.
 */
export const PARKED_LANE_KEYS: ReadonlySet<string> = new Set(['blocked', 'on_hold', 'cancelled']);

/** True when a lane is parked — off the delivery path. */
export function isParkedLane(key: string): boolean {
  return PARKED_LANE_KEYS.has(key);
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
  // Tie-break on `key` so lanes that share a position (which the board API and the MCP
  // tool both allow — `position: body.position ?? 0`) resolve deterministically instead of
  // depending on row order. Measured: board ad030733 has `ready` and `todo` both at 1.
  const sorted = [...lanes].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const idx = sorted.findIndex((l) => l.key === fromStatus);
  if (idx === -1) return null;
  // Walk FORWARD past parked lanes. `blocked` sitting between review and Done is the
  // default board layout, so without this the normal completion path advances tickets
  // into the one lane the autonomous sweep refuses to scan. See {@link PARKED_LANE_KEYS}.
  for (let i = idx + 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (!next) break;
    if (isParkedLane(next.key)) continue;
    // A terminal lane still stops the auto-advance (reaching Done stays explicit).
    return next.isTerminal ? null : next.key;
  }
  return null;
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
  const board = await findCanonicalBoard(db, projectId);
  if (!board) return null;

  const lanes = await db
    .select({ key: swimlanes.key, position: swimlanes.position, isTerminal: swimlanes.isTerminal })
    .from(swimlanes)
    .where(eq(swimlanes.boardId, board.id))
    .orderBy(asc(swimlanes.position));

  return resolveNextLaneKey(lanes, fromStatus);
}

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
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/** Minimal lane shape the ordering needs. */
export interface LanePosition {
  key: string;
  position: number;
  /** Whether this lane finalizes the ticket (a Done/terminal lane). */
  isTerminal?: boolean;
  /** `swimlanes.is_parking` (migration 1080) — the AUTHORITATIVE parked flag. When
   *  absent (a caller that did not select the column, or a hand-built lane list) the
   *  key-set fallback in {@link PARKED_LANE_KEYS} still applies. */
  isParking?: boolean;
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

/**
 * True when a lane is parked — off the delivery path.
 *
 * The key set is now the FALLBACK, not the rule. `swimlanes.is_parking` (migration 1080)
 * is the authoritative flag, seeded from exactly this set, and it is what makes a
 * tenant's own parking lane ("On Hold — Q3", "Waiting on Legal") work: those keys match
 * nothing here, so before the column every custom board kept both bugs this set was
 * added to fix. Callers that have the column pass it; callers that do not (a hand-built
 * lane list, a status with no swimlane) still get the seeded behaviour.
 */
export function isParkedLane(key: string, isParking?: boolean | null): boolean {
  if (isParking != null) return isParking;
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
    if (isParkedLane(next.key, next.isParking)) continue;
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
    .select({ key: swimlanes.key, position: swimlanes.position, isTerminal: swimlanes.isTerminal, isParking: swimlanes.isParking })
    .from(swimlanes)
    // The board was resolved from the project and carries its own tenant, so the scope is
    // stated explicitly here rather than left to ride on `boardId` being unguessable.
    .where(scopedToTenant(swimlanes, board.tenantId, eq(swimlanes.boardId, board.id)))
    .orderBy(asc(swimlanes.position));

  return resolveNextLaneKey(lanes, fromStatus);
}

/**
 * The lane a ticket belongs in the moment a run STARTS. PURE.
 *
 * The RUNNING transition was the last hardcoded hop: `RuntimeService` wrote
 * `TaskStatus.IN_PROGRESS` unconditionally, whatever the board's lanes were called. On
 * the default board that is right by coincidence — `in_progress` is a real lane there —
 * but on a board whose lanes are `intake → spec → build → qa → ship` it wrote a status
 * matching NO column, so a ticket disappeared from the board the instant an agent
 * started working it, and only a human editing the status could bring it back.
 *
 * Resolution, in order:
 *  1. **The lane the run was DISPATCHED FOR.** The lane trigger stamps `laneKey` on the
 *     payload, so the board itself has already answered "which stage is this run
 *     serving". This is what makes the walk position-driven rather than
 *     constant-driven: a run dispatched for `backlog` keeps the ticket in `backlog`
 *     instead of skipping `todo` and `ready` to land on a constant.
 *  2. **A lane literally keyed `in_progress`**, when the board has one — every default
 *     board does, so nothing that works today changes.
 *  3. **Nothing.** Returning null means "leave the ticket where it is", which is the
 *     honest answer for a board with neither: better a ticket in a lane you can see than
 *     a ticket in a status no column renders.
 *
 * Never moves BACKWARD: if the resolved lane sits before the ticket's current one, the
 * ticket stays. A run starting is not a reason to rewind a ticket that has progressed.
 */
export function resolveRunningLaneKey(
  lanes: LanePosition[],
  fromStatus: string,
  dispatchedLaneKey?: string | null,
): string | null {
  const sorted = [...lanes].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const indexOf = (key: string) => sorted.findIndex((l) => l.key === key);
  const from = indexOf(fromStatus);

  const target = (() => {
    if (dispatchedLaneKey && indexOf(dispatchedLaneKey) >= 0) return dispatchedLaneKey;
    return sorted.some((l) => l.key === 'in_progress') ? 'in_progress' : null;
  })();
  if (!target || target === fromStatus) return null;

  // Never rewind. `from < 0` (a status matching no lane) is treated as "before
  // everything", so an off-board ticket is still pulled onto the board when a run starts.
  const to = indexOf(target);
  if (from >= 0 && to <= from) return null;
  return target;
}

/**
 * Resolve the RUNNING-phase lane for a task's project board. Null when the project has
 * no board, or when the ticket should not move — see {@link resolveRunningLaneKey}.
 */
export async function resolveRunningTaskStatus(
  db: Db,
  projectId: number,
  fromStatus: string,
  dispatchedLaneKey?: string | null,
): Promise<string | null> {
  const board = await findCanonicalBoard(db, projectId);
  if (!board) return null;

  const lanes = await db
    .select({ key: swimlanes.key, position: swimlanes.position, isTerminal: swimlanes.isTerminal, isParking: swimlanes.isParking })
    .from(swimlanes)
    // The board was resolved from the project and carries its own tenant, so the scope is
    // stated explicitly here rather than left to ride on `boardId` being unguessable.
    .where(scopedToTenant(swimlanes, board.tenantId, eq(swimlanes.boardId, board.id)))
    .orderBy(asc(swimlanes.position));

  return resolveRunningLaneKey(lanes, fromStatus, dispatchedLaneKey);
}

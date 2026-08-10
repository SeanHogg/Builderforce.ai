/**
 * The ONE definition of "this ticket is finished".
 *
 * `tasks.status` is free-form text (a board lane key), so "done" is not a type —
 * it is a CLASS of lane keys, plus any swimlane a board explicitly flags
 * `is_terminal`. That rule was copy-pasted into four modules (taskLifecycle, the
 * lifecycle ledger, the assignee recommender, reportRoutes), each with a comment
 * pointing at one of the others as the source of truth. It now lives here, and
 * every consumer imports it — so a tenant that adds a `released` terminal lane is
 * folded in once rather than in four places that can silently drift apart.
 *
 * A board-aware caller (one that has loaded swimlane ordinals) should use
 * {@link isDoneLane}, which also honours the per-board `isTerminal` flag. A caller
 * with only a status string uses {@link isDoneStatus}.
 */
import { TaskStatus } from './types';

/** Lane keys that mean "finished" regardless of board configuration. */
export const DONE_CLASS: ReadonlySet<string> = new Set<string>([TaskStatus.DONE]);

/** Array form, for SQL `inArray(...)` predicates. */
export const DONE_CLASS_STATUSES: readonly string[] = [...DONE_CLASS];

/** True when this lane key is done-class by the canonical rule (no board needed). */
export function isDoneStatus(status: string | null | undefined): boolean {
  return status != null && DONE_CLASS.has(status);
}

/** A board lane's terminality, as loaded from `swimlanes` (position + is_terminal). */
export interface LaneTerminality {
  isTerminal: boolean;
}

/**
 * True when the status is done-class OR the project's board flags that lane
 * terminal. Use wherever the board's own lane config is available — a tenant that
 * renamed `done` to `shipped` and flagged it terminal is then counted correctly.
 */
export function isDoneLane(
  status: string | null | undefined,
  lanes: Record<string, LaneTerminality | undefined>,
): boolean {
  if (status == null) return false;
  return DONE_CLASS.has(status) || lanes[status]?.isTerminal === true;
}

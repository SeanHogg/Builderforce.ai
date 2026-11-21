/**
 * Is this ticket still open work, or has it left the board? ONE answer, shared by the
 * api (the progress ladder, chat ticket chips, the `tasks.list` tool's scope) and the
 * VS Code Work view (the open Tasks list and the Closed section).
 *
 * A ticket is CLOSED when its lane is done-class, cancelled, or a synced tracker's
 * equivalent, or when it has been archived. A closed ticket owes nothing: its ring
 * reads 100%, never 0%, and it leaves the default (open) task list.
 *
 * A board can flag its own lane terminal (`swimlanes.is_terminal`). Readers that have
 * the board's lanes loaded still widen with that flag; this module only knows lane
 * keys, so it holds the keys that mean "closed" on every board.
 */

/** The status an ARCHIVED ticket reads as, whatever its stale lane (see {@link effectiveTaskStatus}). */
export const ARCHIVED_TASK_STATUS = "archived";

/** Lane keys that mean "closed" on every board, including tracker spellings. */
export const TASK_CLOSED_STATUSES: readonly string[] = ["done", "cancelled", "canceled", "completed", ARCHIVED_TASK_STATUS];

const CLOSED = new Set(TASK_CLOSED_STATUSES);

/** True when the lane key is closed (done-class or cancelled). Case-insensitive. */
export function isClosedTaskStatus(status: string | null | undefined): boolean {
  return status != null && CLOSED.has(status.trim().toLowerCase());
}

/** Lane keys that mean "cancelled" — closed without delivery (US `canceled` too). A subset of {@link TASK_CLOSED_STATUSES}. */
export const TASK_CANCELLED_STATUSES: readonly string[] = ["cancelled", "canceled"];

const CANCELLED = new Set(TASK_CANCELLED_STATUSES);

/** True for a cancelled lane key (US `canceled` too). */
export function isCancelledTaskStatus(status: string | null | undefined): boolean {
  return CANCELLED.has((status ?? "").trim().toLowerCase());
}

/** The fields the open/closed decision reads. */
export interface TaskClosedFacts {
  status?: string | null;
  archived?: boolean | null;
}

/** Closed = a closed lane OR archived. */
export function isClosedTask(task: TaskClosedFacts): boolean {
  return task.archived === true || isClosedTaskStatus(task.status);
}

/**
 * The status a ticket READS as on every surface (chip, progress, rollups, Hide done): an
 * archived ticket is off the board, so it reads {@link ARCHIVED_TASK_STATUS} (a closed
 * status) even when its lane still says `backlog`; any other ticket reads its own lane.
 * The status-only readers (`isClosedTicketStatus`, `effectiveTicketProgress`) then agree
 * with {@link isClosedTask} without each learning the archived flag.
 */
export function effectiveTaskStatus<S extends string | null | undefined>(
  task: { status: S; archived?: boolean | null },
): S | typeof ARCHIVED_TASK_STATUS {
  return task.archived === true ? ARCHIVED_TASK_STATUS : task.status;
}

/** Which tickets a list returns: open work (the default view), closed, or both. */
export type TaskListScope = "open" | "closed" | "all";

export const TASK_LIST_SCOPES: readonly TaskListScope[] = ["open", "closed", "all"];

/** Parse an untrusted scope; anything unknown falls back to `fallback`. */
export function parseTaskListScope(raw: unknown, fallback: TaskListScope): TaskListScope {
  return typeof raw === "string" && (TASK_LIST_SCOPES as readonly string[]).includes(raw)
    ? (raw as TaskListScope)
    : fallback;
}

/** True when `task` belongs in a list of the given scope. */
export function taskInScope(task: TaskClosedFacts, scope: TaskListScope): boolean {
  if (scope === "all") return true;
  return scope === "closed" ? isClosedTask(task) : !isClosedTask(task);
}

/** Archived tickets are hidden from the default read; a closed or all-scope list must ask for them. */
export function scopeNeedsArchived(scope: TaskListScope): boolean {
  return scope !== "open";
}

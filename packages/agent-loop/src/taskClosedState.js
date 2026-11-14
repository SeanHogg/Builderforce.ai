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
/** Lane keys that mean "closed" on every board, including tracker spellings. */
export const TASK_CLOSED_STATUSES = ["done", "cancelled", "canceled", "completed", "archived"];
const CLOSED = new Set(TASK_CLOSED_STATUSES);
/** True when the lane key is closed (done-class or cancelled). Case-insensitive. */
export function isClosedTaskStatus(status) {
    return status != null && CLOSED.has(status.trim().toLowerCase());
}
/** True for a cancelled lane key (US `canceled` too). */
export function isCancelledTaskStatus(status) {
    const s = (status ?? "").trim().toLowerCase();
    return s === "cancelled" || s === "canceled";
}
/** Closed = a closed lane OR archived. */
export function isClosedTask(task) {
    return task.archived === true || isClosedTaskStatus(task.status);
}
export const TASK_LIST_SCOPES = ["open", "closed", "all"];
/** Parse an untrusted scope; anything unknown falls back to `fallback`. */
export function parseTaskListScope(raw, fallback) {
    return typeof raw === "string" && TASK_LIST_SCOPES.includes(raw)
        ? raw
        : fallback;
}
/** True when `task` belongs in a list of the given scope. */
export function taskInScope(task, scope) {
    if (scope === "all")
        return true;
    return scope === "closed" ? isClosedTask(task) : !isClosedTask(task);
}
/** Archived tickets are hidden from the default read; a closed or all-scope list must ask for them. */
export function scopeNeedsArchived(scope) {
    return scope !== "open";
}
//# sourceMappingURL=taskClosedState.js.map
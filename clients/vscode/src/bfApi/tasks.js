import { isClosedTask } from "@builderforce/agent-loop";
import { ttlCache } from "../ttlCache";
import { authed } from "./transport";
/** Default for the board's hide-closed filter: show only active work, hiding the done
 *  and cancelled columns by default. An explicit user toggle overrides + persists.
 *  (The sidebar needs no toggle: closed tickets live in their own Closed section.) */
export const DEFAULT_HIDE_DONE = true;
// Tasks cache: single-process, short TTL, busted by refresh / status change.
const TASKS_TTL = 30_000;
const taskCache = ttlCache(TASKS_TTL);
export async function listTasks(secrets, projectId, force = false) {
    const cached = taskCache.get(projectId);
    if (!force && cached)
        return cached.value;
    const r = await authed(secrets, `/api/tasks?project_id=${projectId}`);
    const tasks = r?.tasks ?? [];
    taskCache.set(projectId, tasks);
    return tasks;
}
/**
 * A project's tickets read FRESH for a review — never from the 30s sidebar cache, because
 * a review decides merges from it — optionally including archived tickets (a cancelled,
 * archived ticket can still have an unmerged branch).
 */
export async function listTasksForReview(secrets, projectId, includeArchived) {
    const r = await authed(secrets, `/api/tasks?project_id=${projectId}${includeArchived ? "&include_archived=true" : ""}`);
    return r?.tasks ?? [];
}
const closedTaskCache = ttlCache(TASKS_TTL);
/**
 * A project's CLOSED tickets — done, cancelled or archived — for the Work view's Closed
 * section. The default list omits archived rows, so this asks for them; it is cached
 * beside the open list and dropped with it by {@link invalidateTasks}.
 */
export async function listClosedTasks(secrets, projectId) {
    const cached = closedTaskCache.get(projectId);
    if (cached)
        return cached.value;
    const r = await authed(secrets, `/api/tasks?project_id=${projectId}&include_archived=true`);
    const tasks = (r?.tasks ?? []).filter(isClosedTask);
    closedTaskCache.set(projectId, tasks);
    return tasks;
}
export function invalidateTasks(projectId) {
    taskCache.invalidate(projectId);
    closedTaskCache.invalidate(projectId);
}
/** Archive (or restore) a ticket — off the board but recoverable (PATCH archived). */
export async function setTaskArchived(secrets, id, archived) {
    await authed(secrets, `/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ archived }) });
}
/** Permanently delete a ticket (DELETE /api/tasks/:id). Callers confirm first. */
export async function deleteTask(secrets, id) {
    await authed(secrets, `/api/tasks/${id}`, { method: "DELETE" });
}
/**
 * The open tasks assigned to the signed-in user (GET /api/vscode/tasks). Uncached —
 * the caller polls it on the heartbeat cadence to detect newly-assigned work, so a
 * stale cache would defeat the point. Degrades to [] when signed out / not deployed.
 */
export async function listAssignedTasks(secrets) {
    try {
        const r = await authed(secrets, "/api/vscode/tasks");
        return r?.tasks ?? [];
    }
    catch {
        return [];
    }
}
// Project-scoped OKR objectives, cached briefly like tasks so the Hierarchy view's
// top tier doesn't refetch on every expand. Keyed by project id.
const objectiveCache = ttlCache(TASKS_TTL);
/**
 * The project's OKR Objectives + their delivery links — the top tier of the
 * Hierarchy view. Reads the composed project rollup (already read-through cached
 * server-side, 60s). Degrades to [] when the rollup isn't reachable (older API /
 * not a manager), so the tree still renders its board items.
 */
export async function listProjectObjectives(secrets, projectId, force = false) {
    const cached = objectiveCache.get(projectId);
    if (!force && cached)
        return cached.value;
    try {
        const r = await authed(secrets, `/api/pmo/rollup?kind=project&id=${projectId}`);
        const objectives = (r?.okr?.objectives ?? []).map((o) => ({
            id: o.id,
            title: o.title,
            progress: o.progress ?? 0,
            status: o.status,
            linkedTaskIds: (o.links ?? [])
                .filter((l) => l.kind === "task" || l.kind === "epic")
                .map((l) => Number(l.refId))
                .filter((n) => Number.isFinite(n)),
        }));
        objectiveCache.set(projectId, objectives);
        return objectives;
    }
    catch {
        return [];
    }
}
export function invalidateObjectives(projectId) {
    objectiveCache.invalidate(projectId);
}
/** Change a board item's type — task⇄epic, or promote it to an OKR Objective
 *  ('objective'). Server re-links children + scopes the new objective to the
 *  project. Returns false on failure so the caller can surface an error. */
export async function convertTaskType(secrets, id, target) {
    try {
        await authed(secrets, `/api/tasks/${id}/convert-type`, { method: "POST", body: JSON.stringify({ target }) });
        return true;
    }
    catch {
        return false;
    }
}
export async function updateTaskStatus(secrets, id, status) {
    // Partial merge on the server — only status changes (and triggers lane automation).
    await authed(secrets, `/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
}
//# sourceMappingURL=tasks.js.map
import type * as vscode from "vscode";
import { isClosedTask } from "@builderforce/agent-loop";
import { ttlCache } from "../ttlCache";
import { authed } from "./transport";

export interface BfTask {
  id: number;
  key?: string;
  title: string;
  status?: string;
  priority?: string;
  description?: string | null;
  assignedUserId?: string | null;
  /** 'task' (default), 'epic' (decomposes into child tasks), or 'gap' (a validator-
   *  minted follow-up). Drives the sidebar Hierarchy view (mirrors the API's `taskType`). */
  taskType?: "task" | "epic" | "gap";
  /** Parent epic's id (null/undefined for top-level tasks) — the nesting edge for
   *  the Hierarchy view (mirrors the API's `parentTaskId`). */
  parentTaskId?: number | null;
  /** Last-touched timestamp + due date (ISO) — drive the "Needs attention" filter
   *  (stale / overdue). Present in the API's `toPlain()` payload. */
  updatedAt?: string | null;
  dueDate?: string | null;
  /** The ticket's working branch and pull request, as the API's `toPlain()` carries them. */
  gitBranch?: string | null;
  githubPrNumber?: number | null;
  githubPrUrl?: string | null;
  /** State of the ticket's current pull request (`open` / `merged` / `closed`), when it has one. */
  prState?: string | null;
  archived?: boolean;
}

/** A project-scoped OKR Objective + the board items that deliver it — the top tier
 *  of the Hierarchy view (Objective → Epic → task → subtask). Sourced from the
 *  project rollup (`GET /api/pmo/rollup?kind=project`). */
export interface BfObjective {
  id: string;
  title: string;
  progress: number;
  status?: string;
  /** Ids of the tasks/epics linked to this objective (its delivery lineage). */
  linkedTaskIds: number[];
}

/** Default for the board's hide-closed filter: show only active work, hiding the done
 *  and cancelled columns by default. An explicit user toggle overrides + persists.
 *  (The sidebar needs no toggle: closed tickets live in their own Closed section.) */
export const DEFAULT_HIDE_DONE = true;

// Tasks cache: single-process, short TTL, busted by refresh / status change.
const TASKS_TTL = 30_000;
const taskCache = ttlCache<number, BfTask[]>(TASKS_TTL);

export async function listTasks(
  secrets: vscode.SecretStorage,
  projectId: number,
  force = false,
): Promise<BfTask[]> {
  const cached = taskCache.get(projectId);
  if (!force && cached) return cached.value;
  const r = await authed<{ tasks: BfTask[] }>(secrets, `/api/tasks?project_id=${projectId}`);
  const tasks = r?.tasks ?? [];
  taskCache.set(projectId, tasks);
  return tasks;
}

/**
 * A project's tickets read FRESH for a review — never from the 30s sidebar cache, because
 * a review decides merges from it — optionally including archived tickets (a cancelled,
 * archived ticket can still have an unmerged branch).
 */
export async function listTasksForReview(
  secrets: vscode.SecretStorage,
  projectId: number,
  includeArchived: boolean,
): Promise<BfTask[]> {
  const r = await authed<{ tasks: BfTask[] }>(
    secrets,
    `/api/tasks?project_id=${projectId}${includeArchived ? "&include_archived=true" : ""}`,
  );
  return r?.tasks ?? [];
}

const closedTaskCache = ttlCache<number, BfTask[]>(TASKS_TTL);

/**
 * A project's CLOSED tickets — done, cancelled or archived — for the Work view's Closed
 * section. The default list omits archived rows, so this asks for them; it is cached
 * beside the open list and dropped with it by {@link invalidateTasks}.
 */
export async function listClosedTasks(
  secrets: vscode.SecretStorage,
  projectId: number,
): Promise<BfTask[]> {
  const cached = closedTaskCache.get(projectId);
  if (cached) return cached.value;
  const r = await authed<{ tasks: BfTask[] }>(secrets, `/api/tasks?project_id=${projectId}&include_archived=true`);
  const tasks = (r?.tasks ?? []).filter(isClosedTask);
  closedTaskCache.set(projectId, tasks);
  return tasks;
}

export function invalidateTasks(projectId?: number): void {
  taskCache.invalidate(projectId);
  closedTaskCache.invalidate(projectId);
}

/** Archive (or restore) a ticket — off the board but recoverable (PATCH archived). */
export async function setTaskArchived(
  secrets: vscode.SecretStorage,
  id: number,
  archived: boolean,
): Promise<void> {
  await authed(secrets, `/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ archived }) });
}

/** Permanently delete a ticket (DELETE /api/tasks/:id). Callers confirm first. */
export async function deleteTask(secrets: vscode.SecretStorage, id: number): Promise<void> {
  await authed(secrets, `/api/tasks/${id}`, { method: "DELETE" });
}

/** An OPEN work item assigned to the signed-in user, delivered by the API's
 *  /api/vscode/tasks channel (mirrors that endpoint's row shape). This is how work
 *  reaches the editor as an assignable runtime: assign a ticket to the user on the
 *  web board and it surfaces here (tracked HITL). */
interface BfAssignedTask {
  id: number;
  key: string;
  title: string;
  status: string;
  priority: string;
  projectId: number;
  projectPublicId: string;
  projectName: string;
  githubPrUrl: string | null;
  updatedAt: string | null;
}

/**
 * The open tasks assigned to the signed-in user (GET /api/vscode/tasks). Uncached —
 * the caller polls it on the heartbeat cadence to detect newly-assigned work, so a
 * stale cache would defeat the point. Degrades to [] when signed out / not deployed.
 */
export async function listAssignedTasks(secrets: vscode.SecretStorage): Promise<BfAssignedTask[]> {
  try {
    const r = await authed<{ tasks: BfAssignedTask[] }>(secrets, "/api/vscode/tasks");
    return r?.tasks ?? [];
  } catch {
    return [];
  }
}

// Project-scoped OKR objectives, cached briefly like tasks so the Hierarchy view's
// top tier doesn't refetch on every expand. Keyed by project id.
const objectiveCache = ttlCache<number, BfObjective[]>(TASKS_TTL);

/**
 * The project's OKR Objectives + their delivery links — the top tier of the
 * Hierarchy view. Reads the composed project rollup (already read-through cached
 * server-side, 60s). Degrades to [] when the rollup isn't reachable (older API /
 * not a manager), so the tree still renders its board items.
 */
export async function listProjectObjectives(
  secrets: vscode.SecretStorage,
  projectId: number,
  force = false,
): Promise<BfObjective[]> {
  const cached = objectiveCache.get(projectId);
  if (!force && cached) return cached.value;
  try {
    const r = await authed<{
      okr?: { objectives?: Array<{ id: string; title: string; progress: number; status?: string; links?: Array<{ kind: string; refId: string }> }> };
    }>(secrets, `/api/pmo/rollup?kind=project&id=${projectId}`);
    const objectives: BfObjective[] = (r?.okr?.objectives ?? []).map((o) => ({
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
  } catch {
    return [];
  }
}

export function invalidateObjectives(projectId?: number): void {
  objectiveCache.invalidate(projectId);
}

/** Change a board item's type — task⇄epic, or promote it to an OKR Objective
 *  ('objective'). Server re-links children + scopes the new objective to the
 *  project. Returns false on failure so the caller can surface an error. */
export async function convertTaskType(
  secrets: vscode.SecretStorage,
  id: number,
  target: "task" | "epic" | "objective",
): Promise<boolean> {
  try {
    await authed(secrets, `/api/tasks/${id}/convert-type`, { method: "POST", body: JSON.stringify({ target }) });
    return true;
  } catch {
    return false;
  }
}

export async function updateTaskStatus(
  secrets: vscode.SecretStorage,
  id: number,
  status: string,
): Promise<void> {
  // Partial merge on the server — only status changes (and triggers lane automation).
  await authed(secrets, `/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

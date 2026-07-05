import * as vscode from "vscode";
import { getApiKey, getBaseUrl } from "./gateway";
import { ttlCache } from "./ttlCache";

export interface BfProject {
  id: number;
  name: string;
  key?: string;
  status?: string;
}

export interface BfTask {
  id: number;
  key?: string;
  title: string;
  status?: string;
  priority?: string;
  description?: string | null;
  assignedUserId?: string | null;
  /** 'task' (default) or 'epic' — an epic decomposes into child tasks. Drives the
   *  sidebar Hierarchy view (mirrors the API's `taskType`). */
  taskType?: "task" | "epic";
  /** Parent epic's id (null/undefined for top-level tasks) — the nesting edge for
   *  the Hierarchy view (mirrors the API's `parentTaskId`). */
  parentTaskId?: number | null;
  /** Last-touched timestamp + due date (ISO) — drive the "Needs attention" filter
   *  (stale / overdue). Present in the API's `toPlain()` payload. */
  updatedAt?: string | null;
  dueDate?: string | null;
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

/** The terminal task status. Single source of truth for "done" across surfaces
 *  (the board column + the sidebar hide-done filter). */
export const DONE_STATUS = "done";
export const isDoneStatus = (status?: string): boolean => status === DONE_STATUS;
/** Default for the hide-done view filter (board + sidebar): show only active work,
 *  hiding done by default. An explicit user toggle overrides + persists. */
export const DEFAULT_HIDE_DONE = true;

export interface BfExecution {
  id: number;
  taskId?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The outcome of dispatching a platform run (POST /api/runtime/executions). Either a
 * real execution was started (`execution`), or a priority/policy gate intercepted it and
 * a human approval is now pending (`awaitingApproval`). Mutually exclusive.
 */
export interface BfSubmitResult {
  execution?: BfExecution;
  awaitingApproval?: { approvalId: string; taskId: number; reason?: string };
}

/** A pending (or resolved) human-in-the-loop request from the tenant approvals queue.
 *  Mirrors the `approvals` row shape returned by GET/PATCH /api/approvals. */
export interface BfApproval {
  id: string;
  kind?: "approval" | "question" | "feedback" | string;
  actionType?: string;
  description?: string;
  status?: "pending" | "approved" | "rejected" | "answered" | "expired" | string;
  reviewNote?: string | null;
  responseText?: string | null;
  executionId?: number | null;
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
  /** The project this approval belongs to (via its execution's task), or null when it
   *  isn't tied to a task. Server-enriched so the Inbox can scope/label by project. */
  projectId?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Client for BuilderForce's tenant APIs (projects/tasks/connection). The extension holds
 * a `bfk_*` gateway key, which only reaches `/llm/*`; this exchanges it for a short-lived
 * tenant JWT (cached) so it can call `/api/projects`, `/api/tasks`, `/api/vscode/*`.
 * All calls degrade gracefully (return empty / false) when the backend lacks these
 * endpoints (i.e. not yet deployed).
 */
// The editor key is bound to ONE tenant; its exchange yields the "base" JWT. To act on
// another of the user's workspaces we re-scope that base JWT to the selected tenant via
// /api/vscode/tenants/:id/token. Both tokens are cached with their tenant + expiry.
let baseJwt: { token: string; exp: number; tenantId: number } | undefined;
let scopedJwt: { token: string; exp: number; tenantId: number } | undefined;
let selectedTenantId: number | undefined;
let rescopeUnsupported = false; // set once the switch endpoint 404s (not deployed) — stop retrying

/** Set the active workspace (tenant) to act as. `undefined` = the key's own tenant. */
export function setSelectedWorkspace(tenantId: number | undefined): void {
  if (tenantId === selectedTenantId) return;
  selectedTenantId = tenantId;
  scopedJwt = undefined; // re-derive on next call
  workspaceCache = undefined;
}

/** Exchange the stored editor key for its OWN tenant JWT (the key's bound workspace). */
async function exchangeBaseJwt(
  secrets: vscode.SecretStorage,
  force: boolean,
): Promise<{ token: string; tenantId: number } | undefined> {
  if (!force && baseJwt && Date.now() < baseJwt.exp - 60_000) return baseJwt;
  const key = await getApiKey(secrets);
  if (!key) return undefined;
  try {
    const res = await fetch(`${getBaseUrl()}/api/auth/tenant-api-key-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { token?: string; expiresIn?: number; tenantId?: number };
    if (!body.token || typeof body.tenantId !== "number") return undefined;
    baseJwt = { token: body.token, exp: Date.now() + (body.expiresIn ?? 3600) * 1000, tenantId: body.tenantId };
    return baseJwt;
  } catch {
    return undefined;
  }
}

async function exchangeJwt(secrets: vscode.SecretStorage, force = false): Promise<string | undefined> {
  const base = await exchangeBaseJwt(secrets, force);
  if (!base) return undefined;
  const target = selectedTenantId ?? base.tenantId;
  if (target === base.tenantId || rescopeUnsupported) return base.token;
  if (!force && scopedJwt && scopedJwt.tenantId === target && Date.now() < scopedJwt.exp - 60_000) {
    return scopedJwt.token;
  }
  // Re-scope to another of the user's workspaces. Degrades to the base token: 404 =
  // endpoint not deployed (latch off), 403 = no longer a member (drop the selection).
  try {
    const res = await fetch(`${getBaseUrl()}/api/vscode/tenants/${target}/token`, {
      method: "POST",
      headers: { authorization: `Bearer ${base.token}`, "content-type": "application/json" },
    });
    if (res.status === 404) {
      rescopeUnsupported = true;
      return base.token;
    }
    if (res.status === 403) {
      selectedTenantId = base.tenantId;
      return base.token;
    }
    if (!res.ok) return base.token;
    const body = (await res.json()) as { token?: string; expiresIn?: number };
    if (!body.token) return base.token;
    scopedJwt = { token: body.token, exp: Date.now() + (body.expiresIn ?? 3600) * 1000, tenantId: target };
    return scopedJwt.token;
  } catch {
    return base.token;
  }
}

export function clearJwt(): void {
  baseJwt = undefined;
  scopedJwt = undefined;
  rescopeUnsupported = false;
  workspaceCache = undefined;
  currentUserId = undefined;
  evermindHeadCache.invalidate();
}

// The signed-in human's user id (from GET /api/vscode/me), cached for the session so
// the "assigned to me" task filter doesn't refetch. `null` = resolved-but-unavailable
// (older API); undefined = not yet fetched. Cleared on sign-out via clearJwt.
let currentUserId: string | null | undefined;

/**
 * The signed-in user's id — for the "Assigned to me" task filter. Cached; returns
 * null when the identity endpoint isn't reachable (older API), so the caller can
 * degrade the filter to a no-op rather than hide everything.
 */
export async function getCurrentUserId(secrets: vscode.SecretStorage): Promise<string | null> {
  if (currentUserId !== undefined) return currentUserId;
  try {
    const r = await authed<{ userId?: string }>(secrets, "/api/vscode/me");
    currentUserId = r?.userId ?? null;
  } catch {
    currentUserId = null;
  }
  return currentUserId;
}

// The active workspace's {id, name}, cached until the workspace changes / sign-out.
let workspaceCache: { id: number; name: string } | undefined;

/**
 * The workspace (tenant) the editor is currently acting as — for the sidebar header.
 * Resolves the active tenant id (selected or the key's own), then its name from the
 * user's workspace list (new endpoint) or `GET /api/tenants/:id` (works on older APIs).
 * Returns undefined when signed out or the name can't be resolved.
 */
export async function getCurrentWorkspace(
  secrets: vscode.SecretStorage,
): Promise<{ id: number; name: string } | undefined> {
  const token = await exchangeJwt(secrets);
  if (!token || !baseJwt) return undefined;
  const id = selectedTenantId ?? baseJwt.tenantId;
  if (workspaceCache && workspaceCache.id === id) return workspaceCache;

  let name: string | undefined;
  try {
    name = (await listWorkspaces(secrets)).find((w) => w.id === id)?.name;
  } catch {
    /* /api/vscode/tenants not deployed — fall back below */
  }
  if (!name) {
    try {
      name = (await authed<{ name?: string }>(secrets, `/api/tenants/${id}`))?.name;
    } catch {
      /* ignore — header just stays empty */
    }
  }
  if (!name) return undefined;
  workspaceCache = { id, name };
  return workspaceCache;
}

/** The tenant JWT for embedding web pages (handed to the iframe via postMessage). */
export function getTenantJwt(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return exchangeJwt(secrets);
}

async function authed<T>(
  secrets: vscode.SecretStorage,
  path: string,
  init?: RequestInit,
): Promise<T | undefined> {
  let token = await exchangeJwt(secrets);
  if (!token) return undefined;
  const call = (t: string) =>
    fetch(`${getBaseUrl()}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${t}`, "content-type": "application/json" },
    });
  let res = await call(token);
  if (res.status === 401) {
    token = await exchangeJwt(secrets, true);
    if (!token) return undefined;
    res = await call(token);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} → HTTP ${res.status} ${body.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

/**
 * Probe the full chain (key → token exchange → /api/projects) and return a readable
 * report of the exact status at each hop. Used by the "Diagnose Connection" command so a
 * failure shows WHERE it broke instead of a generic "backend not updated".
 */
export async function diagnose(secrets: vscode.SecretStorage): Promise<string> {
  const base = getBaseUrl();
  const lines: string[] = [`Base URL: ${base}`];
  const key = await getApiKey(secrets);
  if (!key) return [...lines, "Not signed in (no API key stored)."].join("\n");
  lines.push(`API key: ${key.slice(0, 6)}…${key.slice(-3)} (length ${key.length})`);

  let token: string | undefined;
  try {
    const r = await fetch(`${base}/api/auth/tenant-api-key-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    const txt = await r.text();
    lines.push(`POST /api/auth/tenant-api-key-token → HTTP ${r.status}`);
    if (r.ok) {
      try {
        token = (JSON.parse(txt) as { token?: string }).token;
      } catch {
        /* non-JSON */
      }
      lines.push(token ? "  ✓ tenant token received" : `  ✗ token missing in body: ${txt.slice(0, 140)}`);
    } else {
      lines.push(`  ✗ ${txt.slice(0, 200)}`);
      if (r.status === 404) lines.push("  → exchange endpoint not found: the API deploy is missing this build.");
    }
  } catch (e) {
    lines.push(`POST /api/auth/tenant-api-key-token → network error: ${(e as Error).message}`);
  }
  if (!token) return lines.join("\n");

  try {
    const r = await fetch(`${base}/api/projects`, { headers: { authorization: `Bearer ${token}` } });
    const txt = await r.text();
    lines.push(`GET /api/projects → HTTP ${r.status}`);
    if (r.ok) {
      let n = 0;
      try {
        n = ((JSON.parse(txt) as { projects?: unknown[] }).projects ?? []).length;
      } catch {
        /* */
      }
      lines.push(`  ✓ ${n} project(s) returned`);
    } else {
      lines.push(`  ✗ ${txt.slice(0, 240)}`);
      if (r.status === 428) lines.push("  → terms acceptance required for this user; accept the latest Terms in the web app, then retry.");
      if (r.status === 401) lines.push("  → token rejected by the API (JWT secret mismatch or expired). ");
    }
  } catch (e) {
    lines.push(`GET /api/projects → network error: ${(e as Error).message}`);
  }
  return lines.join("\n");
}

export async function listProjects(secrets: vscode.SecretStorage): Promise<BfProject[]> {
  const r = await authed<{ projects: BfProject[] }>(secrets, "/api/projects");
  return r?.projects ?? [];
}

/**
 * The per-project Evermind head — the self-learning model assigned to a project.
 * Mirrors the api `headCore` response (projectEvermindRoutes.ts). `inferenceEnabled`
 * is the manager opt-in that governs whether the project's agent runs execute ON
 * its Evermind; `seeded` is `version > 0`.
 */
export interface BfProjectEvermindHead {
  version: number;
  ref: string | null;
  mode?: string;
  name?: string | null;
  contributions?: number;
  inferenceEnabled: boolean;
  seeded: boolean;
}

// Single-process, short-TTL cache (shared ttlCache): the head is slow-changing yet
// read on every chat turn's model resolution. Caches a negative (undefined) head too,
// so an unreachable/unowned project isn't refetched every turn. Busted on sign-out
// (clearJwt) and via invalidateProjectEvermind.
const evermindHeadCache = ttlCache<number, BfProjectEvermindHead | undefined>(60_000);

/**
 * The project's Evermind head (GET /api/projects/:id/evermind/head). Used to decide
 * whether an editor chat turn should run on the project's Evermind — honoring the
 * SAME `inferenceEnabled` opt-in the cloud/on-prem dispatcher uses. Degrades to
 * undefined when the endpoint isn't reachable / project not owned, so chat always
 * falls back to the default model.
 */
export async function getProjectEvermindHead(
  secrets: vscode.SecretStorage,
  projectId: number,
  force = false,
): Promise<BfProjectEvermindHead | undefined> {
  const cached = evermindHeadCache.get(projectId);
  if (!force && cached) return cached.value;
  let head: BfProjectEvermindHead | undefined;
  try {
    head = await authed<BfProjectEvermindHead>(secrets, `/api/projects/${projectId}/evermind/head`);
  } catch {
    head = undefined; // not deployed / not owned / offline — chat falls back to default
  }
  evermindHeadCache.set(projectId, head);
  return head;
}

/** Invalidate the cached Evermind head (e.g. after toggling inference in the web app). */
export function invalidateProjectEvermind(projectId?: number): void {
  evermindHeadCache.invalidate(projectId);
}

/** One durable belief in the SHARED per-project facts store (server-side, not local disk). */
export interface BfProjectFact {
  key: string;
  content: string;
}

/**
 * Recall the project's shared facts (GET /api/projects/:id/facts). The SAME store the
 * cloud + on-prem agents read, so the editor recalls beliefs any surface wrote.
 * Degrades to [] when signed out / not deployed / project not owned.
 */
export async function recallProjectFacts(
  secrets: vscode.SecretStorage,
  projectId: number,
  query?: string,
  limit = 5,
): Promise<BfProjectFact[]> {
  try {
    const qs = new URLSearchParams();
    if (query) qs.set('query', query);
    qs.set('limit', String(limit));
    const r = await authed<{ facts: BfProjectFact[] }>(secrets, `/api/projects/${projectId}/facts?${qs.toString()}`);
    return r?.facts ?? [];
  } catch {
    return [];
  }
}

/**
 * Write-through a belief to the project's SHARED facts store (POST …/facts). Replaces
 * by stable key server-side, so cloud/on-prem/editor runs all see it. Best-effort.
 */
export async function rememberProjectFact(
  secrets: vscode.SecretStorage,
  projectId: number,
  key: string,
  content: string,
): Promise<boolean> {
  try {
    const r = await authed<{ ok?: boolean }>(secrets, `/api/projects/${projectId}/facts`, {
      method: 'POST',
      body: JSON.stringify({ key, content, source: 'vscode' }),
    });
    return !!r?.ok;
  } catch {
    return false;
  }
}

/** A workspace (tenant) the signed-in user belongs to. */
export interface BfWorkspace {
  id: number;
  name: string;
  role?: string;
}

/**
 * The user's workspaces (GET /api/vscode/tenants). Throws if the endpoint isn't
 * deployed (404) — the caller falls back to the web onboarding deep-link.
 */
export async function listWorkspaces(secrets: vscode.SecretStorage): Promise<BfWorkspace[]> {
  const r = await authed<{ tenants: BfWorkspace[] }>(secrets, "/api/vscode/tenants");
  return r?.tenants ?? [];
}

/** Create a workspace (tenant); the caller becomes its owner. */
export async function createWorkspace(
  secrets: vscode.SecretStorage,
  name: string,
): Promise<BfWorkspace> {
  const t = await authed<BfWorkspace>(secrets, "/api/vscode/tenants", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!t) throw new Error("not signed in");
  return t;
}

/**
 * Create a project in the signed-in workspace (tenant) — POST /api/projects, which
 * accepts the extension's tenant JWT. Surfaces the plan-limit (402) message verbatim
 * so the caller can prompt an upgrade. The created project is returned for selection.
 */
export async function createProject(
  secrets: vscode.SecretStorage,
  name: string,
): Promise<BfProject> {
  const project = await authed<BfProject>(secrets, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!project) throw new Error("not signed in");
  return project;
}

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

export function invalidateTasks(projectId?: number): void {
  taskCache.invalidate(projectId);
}

/** An OPEN work item assigned to the signed-in user, delivered by the API's
 *  /api/vscode/tasks channel (mirrors that endpoint's row shape). This is how work
 *  reaches the editor as an assignable runtime: assign a ticket to the user on the
 *  web board and it surfaces here (tracked HITL). */
export interface BfAssignedTask {
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

/** A server-side Brain conversation (GET /api/brain/chats). The SAME unified chat
 *  store the web app and the in-editor Brain webview share. */
export interface BfBrainChat {
  id: number;
  title: string;
  projectId: number | null;
  origin?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * List the tenant's Brain conversations (GET /api/brain/chats) for the Sessions
 * sidebar — the SAME conversations the webview's `/api/brain` persistence loads, so
 * the sidebar, the in-panel switcher and the web app all show one unified history.
 * Degrades to [] when signed out / unreachable.
 */
export async function listBrainChats(
  secrets: vscode.SecretStorage,
  limit = 50,
): Promise<BfBrainChat[]> {
  try {
    const r = await authed<{ chats: BfBrainChat[] }>(secrets, `/api/brain/chats?limit=${limit}`);
    return r?.chats ?? [];
  } catch {
    return [];
  }
}

/** Rename a Brain conversation (PATCH /api/brain/chats/:id). */
export async function renameBrainChat(
  secrets: vscode.SecretStorage,
  id: number,
  title: string,
): Promise<void> {
  await authed(secrets, `/api/brain/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

/** Delete a Brain conversation (DELETE /api/brain/chats/:id). */
export async function deleteBrainChat(secrets: vscode.SecretStorage, id: number): Promise<void> {
  await authed(secrets, `/api/brain/chats/${id}`, { method: "DELETE" });
}

export async function updateTaskStatus(
  secrets: vscode.SecretStorage,
  id: number,
  status: string,
): Promise<void> {
  // Partial merge on the server — only status changes (and triggers lane automation).
  await authed(secrets, `/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

/** One activity signal the VSIX reports for the billable-timecard pipeline. */
export interface VsixActivitySignal {
  kind: string;
  ref?: string;
  weight?: number;
  durationSeconds?: number;
  projectId?: number;
  occurredAt?: string;
  metadata?: unknown;
}

/**
 * Push a batch of audited "click sense" signals from the editor (source 'vscode').
 * Best-effort: capture must never disrupt the editor, so errors are swallowed. The
 * server attributes each signal to the signed-in user + active tenant and resolves
 * it into billable time (see api/src/presentation/routes/activityRoutes.ts).
 */
export async function postActivitySignals(
  secrets: vscode.SecretStorage,
  signals: VsixActivitySignal[],
): Promise<void> {
  if (signals.length === 0) return;
  try {
    await authed(secrets, `/api/activity/ingest`, { method: "POST", body: JSON.stringify({ signals }) });
  } catch {
    /* best-effort activity capture */
  }
}

/**
 * Like `authed`, but returns the raw status + parsed body instead of throwing on
 * non-2xx — used by dispatch where 202 (approval gate) and 402 (plan limit) are
 * meaningful, expected outcomes the caller must branch on, not failures. Reuses the
 * same JWT exchange + 401-retry as `authed` (DRY). Throws only on "not signed in".
 */
async function authedRaw<T>(
  secrets: vscode.SecretStorage,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T | undefined; text: string }> {
  let token = await exchangeJwt(secrets);
  if (!token) throw new Error("not_signed_in");
  const call = (t: string) =>
    fetch(`${getBaseUrl()}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${t}`, "content-type": "application/json" },
    });
  let res = await call(token);
  if (res.status === 401) {
    token = await exchangeJwt(secrets, true);
    if (!token) throw new Error("not_signed_in");
    res = await call(token);
  }
  const text = await res.text().catch(() => "");
  let body: T | undefined;
  try {
    body = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.status, body, text };
}

/**
 * A failed platform dispatch, carrying the structured detail the command layer needs
 * to show a SPECIFIC, actionable message instead of the raw HTTP dump. `httpStatus`
 * branches the outcome (402 → run-limit upgrade, 429 → token-budget), `code` is the
 * gateway's machine code (e.g. `plan_token_limit_exceeded`), and `serverMessage` is
 * the human-readable reason the API already tailored to the tenant's plan.
 */
export class BfDispatchError extends Error {
  readonly httpStatus: number;
  readonly code?: string;
  readonly serverMessage?: string;
  constructor(message: string, detail: { httpStatus: number; code?: string; serverMessage?: string }) {
    super(message);
    this.name = "BfDispatchError";
    this.httpStatus = detail.httpStatus;
    this.code = detail.code;
    this.serverMessage = detail.serverMessage;
  }
}

/**
 * Dispatch a PLATFORM run for a task — the SAME endpoint the web app's
 * `runtimeApi.submitExecution` hits (POST /api/runtime/executions). This is DISTINCT
 * from the local in-editor agent loop: it asks the platform to run the task on its
 * assigned AgentHost / cloud agent. The run is then observable on the board / web app.
 *
 * Returns either the started execution (HTTP 201) or, when a priority/policy gate fires,
 * an `awaitingApproval` descriptor (HTTP 202). On any other status throws a
 * {@link BfDispatchError} carrying the HTTP status, the gateway's machine `code`, and
 * the server's tailored message so the command layer can branch (402 → run-limit
 * upgrade, 429 → token-budget) and show the specific reason.
 */
export async function submitExecution(
  secrets: vscode.SecretStorage,
  taskId: number,
  opts?: { agentHostId?: number | null; sessionId?: string; payload?: string },
): Promise<BfSubmitResult> {
  const { status, body, text } = await authedRaw<
    BfExecution & { status?: string; approvalId?: string; reason?: string; error?: string; code?: string }
  >(secrets, "/api/runtime/executions", {
    method: "POST",
    body: JSON.stringify({ taskId, ...opts }),
  });

  if (status === 202 && body?.approvalId) {
    return { awaitingApproval: { approvalId: body.approvalId, taskId, reason: body.reason } };
  }
  if (status === 201 || status === 200) {
    return { execution: body as BfExecution };
  }
  // Non-2xx: hand the command layer structured detail (status + code + the server's
  // tailored message) instead of a raw dump. Falls back to the verbatim status line
  // when the body carried no JSON `error` (e.g. an infra 5xx).
  const serverMessage = typeof body?.error === "string" ? body.error : undefined;
  throw new BfDispatchError(
    serverMessage ?? `/api/runtime/executions → HTTP ${status} ${text.slice(0, 200)}`,
    { httpStatus: status, code: typeof body?.code === "string" ? body.code : undefined, serverMessage },
  );
}

/**
 * List human-in-the-loop approvals for the active tenant — the SAME endpoint the web
 * HumanRequestsView uses (GET /api/approvals). Defaults to `pending`. Optionally narrows
 * to one on-prem agent host. Degrades to [] when the endpoint isn't deployed.
 */
export async function listHumanRequests(
  secrets: vscode.SecretStorage,
  opts?: { status?: string; agentHostId?: number },
): Promise<BfApproval[]> {
  const status = opts?.status ?? "pending";
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (opts?.agentHostId != null) params.set("agentHostId", String(opts.agentHostId));
  const qs = params.toString();
  try {
    const r = await authed<{ approvals: BfApproval[] }>(
      secrets,
      `/api/approvals${qs ? `?${qs}` : ""}`,
    );
    return r?.approvals ?? [];
  } catch {
    return [];
  }
}

/**
 * Resolve a human-in-the-loop request — the SAME endpoint the web ApprovalResolveControl
 * uses (PATCH /api/approvals/:id). `decision` maps to the backend status:
 *   - "approve" → "approved", "reject" → "rejected" (kind: approval)
 *   - "answer"  → "answered" (kind: question/feedback; requires `note` as responseText)
 * `note` is the review note for approve/reject, or the answer text for "answer".
 * Returns the updated approval (may carry `startedExecutionId` when an approval started a run).
 */
export async function resolveHumanRequest(
  secrets: vscode.SecretStorage,
  id: string,
  decision: "approve" | "reject" | "answer",
  note?: string,
): Promise<BfApproval & { startedExecutionId?: number | null }> {
  const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "answered";
  const payload: { status: string; reviewNote?: string; responseText?: string } = { status };
  if (decision === "answer") payload.responseText = note ?? "";
  else if (note) payload.reviewNote = note;

  const r = await authed<BfApproval & { startedExecutionId?: number | null }>(
    secrets,
    `/api/approvals/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  if (!r) throw new Error("not signed in");
  return r;
}

export async function connect(
  secrets: vscode.SecretStorage,
  machineName: string,
  extensionVersion: string,
): Promise<boolean> {
  try {
    const r = await authed<{ ok?: boolean }>(secrets, "/api/vscode/connect", {
      method: "POST",
      body: JSON.stringify({ machineName, extensionVersion }),
    });
    return !!r?.ok;
  } catch {
    return false;
  }
}

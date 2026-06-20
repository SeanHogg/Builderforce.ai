import * as vscode from "vscode";
import { getApiKey, getBaseUrl } from "./gateway";

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
}

export interface BfExecution {
  id: number;
  taskId?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** A prior conversation turn loaded from a task's server-side execution thread. */
export interface BfConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Client for BuilderForce's tenant APIs (projects/tasks/connection). The extension holds
 * a `bfk_*` gateway key, which only reaches `/llm/*`; this exchanges it for a short-lived
 * tenant JWT (cached) so it can call `/api/projects`, `/api/tasks`, `/api/vscode/*`.
 * All calls degrade gracefully (return empty / false) when the backend lacks these
 * endpoints (i.e. not yet deployed).
 */
let jwt: { token: string; exp: number } | undefined;

async function exchangeJwt(secrets: vscode.SecretStorage, force = false): Promise<string | undefined> {
  if (!force && jwt && Date.now() < jwt.exp - 60_000) return jwt.token;
  const key = await getApiKey(secrets);
  if (!key) return undefined;
  try {
    const res = await fetch(`${getBaseUrl()}/api/auth/tenant-api-key-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { token?: string; expiresIn?: number };
    if (!body.token) return undefined;
    jwt = { token: body.token, exp: Date.now() + (body.expiresIn ?? 3600) * 1000 };
    return jwt.token;
  } catch {
    return undefined;
  }
}

export function clearJwt(): void {
  jwt = undefined;
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

// Tasks cache: single-process, short TTL, busted by refresh / status change.
const taskCache = new Map<number, { ts: number; tasks: BfTask[] }>();
const TASKS_TTL = 30_000;

export async function listTasks(
  secrets: vscode.SecretStorage,
  projectId: number,
  force = false,
): Promise<BfTask[]> {
  const cached = taskCache.get(projectId);
  if (!force && cached && Date.now() - cached.ts < TASKS_TTL) return cached.tasks;
  const r = await authed<{ tasks: BfTask[] }>(secrets, `/api/tasks?project_id=${projectId}`);
  const tasks = r?.tasks ?? [];
  taskCache.set(projectId, { ts: Date.now(), tasks });
  return tasks;
}

export function invalidateTasks(projectId?: number): void {
  if (projectId == null) taskCache.clear();
  else taskCache.delete(projectId);
  // Conversations are keyed by task, not project, so a project-level bust can't
  // target them precisely — clear all (small, TTL-bounded) so a freshly-run task
  // re-hydrates its latest transcript on next open.
  conversationCache.clear();
}

// Task conversation cache: single-process, short TTL, busted by invalidateTasks.
// (Same rationale as taskCache: one Node host serving one user — a local TTL map
// is the correct shape; the cross-isolate getOrSetCached rule governs the backend.)
const conversationCache = new Map<number, { ts: number; messages: BfConversationMessage[] }>();
const CONVERSATION_TTL = 30_000;

/**
 * Load a task's existing conversation from the server — the durable message thread
 * of its most-recent execution (GET /tasks/:id/executions → GET /executions/:id/trace).
 * Hydrates a VS Code chat panel so opening a task shows its real history instead of a
 * blank composer. Degrades to [] when the task has no executions/messages yet or the
 * runtime endpoints aren't reachable.
 */
export async function loadTaskConversation(
  secrets: vscode.SecretStorage,
  taskId: number,
  force = false,
): Promise<BfConversationMessage[]> {
  const cached = conversationCache.get(taskId);
  if (!force && cached && Date.now() - cached.ts < CONVERSATION_TTL) return cached.messages;

  let messages: BfConversationMessage[] = [];
  try {
    const executions =
      (await authed<BfExecution[]>(secrets, `/api/runtime/tasks/${taskId}/executions`)) ?? [];
    const latest = pickLatestExecution(executions);
    if (latest) {
      const trace = await authed<{ trace?: { messages?: Array<{ role?: string; text?: string }> } }>(
        secrets,
        `/api/runtime/executions/${latest.id}/trace`,
      );
      messages = (trace?.trace?.messages ?? [])
        .filter((m): m is { role?: string; text: string } => typeof m.text === "string" && m.text.trim() !== "")
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
    }
  } catch {
    messages = [];
  }
  conversationCache.set(taskId, { ts: Date.now(), messages });
  return messages;
}

/** Newest execution by updated/created time (falls back to id when timestamps are absent). */
function pickLatestExecution(executions: BfExecution[]): BfExecution | undefined {
  if (!executions.length) return undefined;
  const time = (e: BfExecution): number => {
    const t = Date.parse(e.updatedAt ?? e.createdAt ?? "");
    return Number.isFinite(t) ? t : e.id;
  };
  return [...executions].sort((a, b) => time(b) - time(a))[0];
}

export async function updateTaskStatus(
  secrets: vscode.SecretStorage,
  id: number,
  status: string,
): Promise<void> {
  // Partial merge on the server — only status changes (and triggers lane automation).
  await authed(secrets, `/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
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

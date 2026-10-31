import type * as vscode from "vscode";
import type { EvermindRunHooks, ProjectMemoryRequest } from "@seanhogg/builderforce-brain-embedded";
import { projectMemoryHooks } from "@seanhogg/builderforce-brain-embedded";
import { ttlCache } from "../ttlCache";
import { onSessionChange } from "./session";
import { authed } from "./transport";

/**
 * The per-project Evermind head — the self-learning model assigned to a project.
 * Mirrors the api `headCore` response (projectEvermindRoutes.ts). `inferenceEnabled`
 * is the manager opt-in that governs whether the project's agent runs execute ON
 * its Evermind; `seeded` is `version > 0`.
 */
interface BfProjectEvermindHead {
  version: number;
  ref: string | null;
  mode?: string;
  name?: string | null;
  contributions?: number;
  inferenceEnabled: boolean;
  seeded: boolean;
  /** The Evermind CODING gate (api `evermindCodingGate`): may this head serve IDE coding
   *  turns — a coding eval recorded for THIS version ≥ 90% of the frontier baseline.
   *  Absent on an older api, which the chat treats as closed. */
  codingGate?: { qualified: boolean; reason?: string; ratio?: number | null; bar?: number };
}

// Single-process, short-TTL cache (shared ttlCache): the head is slow-changing yet
// read on every chat turn's model resolution. Caches a negative (undefined) head too,
// so an unreachable/unowned project isn't refetched every turn. Busted on sign-out
// (clearJwt) and via invalidateProjectEvermind.
const evermindHeadCache = ttlCache<number, BfProjectEvermindHead | undefined>(60_000);
onSessionChange((change) => { if (change === "reset") evermindHeadCache.invalidate(); });

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
interface BfProjectFact {
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
 *
 * `meta` carries what the route records beside the fact (`RememberFactBody`): the server
 * `chatId` it came from (its origin cost, and the chat's Memory gate — a chat with memory
 * off answers `ok:false, reason:'memory-off'`) and the `fileAnchors` it is about.
 */
export async function rememberProjectFact(
  secrets: vscode.SecretStorage,
  projectId: number,
  key: string,
  content: string,
  meta?: { chatId?: number; fileAnchors?: Array<{ path: string }> },
): Promise<boolean> {
  try {
    const r = await authed<{ ok?: boolean }>(secrets, `/api/projects/${projectId}/facts`, {
      method: 'POST',
      body: JSON.stringify({
        key,
        content,
        source: 'vscode',
        ...(meta?.chatId != null ? { chatId: meta.chatId } : {}),
        ...(meta?.fileAnchors?.length ? { fileAnchors: meta.fileAnchors } : {}),
      }),
    });
    return !!r?.ok;
  } catch {
    return false;
  }
}

/**
 * Remove one fact from the project's SHARED facts store (DELETE …/facts/:key) — for a
 * writer retiring a fact it owns (e.g. a workspace digest for a sub-project that no
 * longer exists). Best-effort.
 */
export async function forgetProjectFact(
  secrets: vscode.SecretStorage,
  projectId: number,
  key: string,
): Promise<boolean> {
  try {
    const r = await authed<{ ok?: boolean }>(secrets, `/api/projects/${projectId}/facts/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    return !!r?.ok;
  } catch {
    return false;
  }
}

/**
 * The extension's authenticated JSON transport as the shared `ProjectMemoryRequest` port
 * — so the native participant and the host-owned run build their memory hooks with the
 * SAME factory the webview and the web Brain use (`projectMemoryHooks`), instead of a
 * hand-written copy of the routes that had already drifted (no chat tiering, no model or
 * production cost for the savings ledger).
 */
export function bfApiRequest(secrets: vscode.SecretStorage): ProjectMemoryRequest {
  return <T>(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
    authed<T>(secrets, path, init) as Promise<T>;
}

/**
 * The project-Evermind memory hooks for a run loop, bound to one project — the host half
 * of "recall → memory-first answer → cache the answer", built by the shared factory.
 * `chatId` tiers recall on the conversation when it is a server chat.
 *
 * Server tier only, on purpose. This runs in the extension host (Node), which has no
 * WebGPU, so composing `loadOnDeviceAnswerStore` here would be a store that is always
 * null — wiring it would look like on-device memory and never answer. The interactive
 * chat composes that tier in the webview (`vsixWebviewMemoryHooks`). A Node WebGPU
 * store is what would unblock this path; do not fake it.
 */
export function projectEvermindHooks(
  secrets: vscode.SecretStorage,
  projectId: number,
  chatId?: number | null,
): EvermindRunHooks {
  return projectMemoryHooks(projectId, bfApiRequest(secrets), chatId ?? null, 'vsix');
}

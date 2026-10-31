import type * as vscode from "vscode";
import type { SpendSavingsSummary } from "@seanhogg/builderforce-brain-embedded";
import { authed } from "./transport";

/** A server-side Brain conversation (GET /api/brain/chats). The SAME unified chat
 *  store the web app and the in-editor Brain webview share. */
export interface BfBrainChat {
  id: number;
  title: string;
  projectId: number | null;
  origin?: string;
  /** The chat's owner (`chatColumns.ownerId`) — a shared chat's is a colleague. */
  ownerId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Agents/humans invited into the chat (multi-party chat). Refs resolve to
   *  display names via {@link listAgentPool}. Absent on older servers. */
  participants?: Array<{ ref: string; kind: string }>;
  /** Linked-ticket count from GET /api/brain/chats. Absent on older servers. */
  ticketCount?: number;
  /** Overall linked-ticket progress 0–100, or null when none are linked. */
  ticketProgressPct?: number | null;
  /** What the chat cost and what memory saved it (`attachChatSpend`). Absent on older servers. */
  spend?: SpendSavingsSummary | null;
}

/** An agent in the tenant's pool, id→display-name (for resolving participant refs). */
interface BfAgentPoolEntry {
  ref: string;
  name: string;
}

/**
 * The tenant's agent pool (workforce owned/purchased + registered agents), so a
 * chat's participant refs can be shown as names/initials. Stable tenant data —
 * the caller should fetch once and cache. Degrades to [] when signed out.
 */
export async function listAgentPool(secrets: vscode.SecretStorage): Promise<BfAgentPoolEntry[]> {
  try {
    const [mine, purchased, registered] = await Promise.all([
      authed<Array<{ id: string | number; name: string }>>(secrets, '/api/workforce/agents/mine').catch(() => undefined),
      authed<Array<{ id: string | number; name: string }>>(secrets, '/api/workforce/agents/purchased').catch(() => undefined),
      authed<Array<{ id: string | number; name: string; isActive?: boolean }>>(secrets, '/api/agents').catch(() => undefined),
    ]);
    const byRef = new Map<string, string>();
    for (const a of [...(mine ?? []), ...(purchased ?? [])]) byRef.set(String(a.id), a.name);
    for (const a of registered ?? []) if (a.isActive !== false) byRef.set(String(a.id), a.name);
    return [...byRef.entries()].map(([ref, name]) => ({ ref, name }));
  } catch {
    return [];
  }
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

/**
 * Create a Brain conversation (POST /api/brain/chats) and return its id — the BIND of a
 * local chat (PRD 36, `chatAccount.ts`): a title and a project, never the transcript.
 * Returns null when signed out / unreachable (the chat then stays local).
 */
export async function createBrainChat(
  secrets: vscode.SecretStorage,
  input: { title?: string; projectId?: number | null },
): Promise<number | null> {
  try {
    const r = await authed<{ id?: number }>(secrets, `/api/brain/chats`, {
      method: "POST",
      body: JSON.stringify({ title: input.title, projectId: input.projectId ?? null }),
    });
    return typeof r?.id === "number" ? r.id : null;
  } catch {
    return null;
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

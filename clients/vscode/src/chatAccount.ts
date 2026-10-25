/**
 * The ACCOUNT side of a local chat (PRD 36) — the editor's half of the binding port the
 * shared chat identity (`createLocalChatIdentity`) and local persistence read:
 *
 *   - the destination a chat binds into: this platform + the workspace `/api/*` acts as;
 *   - whether a bind may be made now (a connected feature: it sends a title and project,
 *     never the transcript — the route rule says so in `@builderforce/local-first`);
 *   - the bind itself (`POST /api/brain/chats`);
 *   - the platform's spend for bound chats — one list read, briefly cached, for every
 *     chat a list shows (never one request per chat).
 */

import type * as vscode from "vscode";
import type { EntityDestination } from "@builderforce/local-first";
import type { ChatBindingPort, SpendSavingsSummary } from "@seanhogg/builderforce-brain-embedded";
import { createBrainChat, listBrainChats, workspaceTenantId } from "./bfApi";
import { getBaseUrl } from "./gateway";
import { platformPolicy } from "./platformPolicy";
import { ttlCache } from "./ttlCache";

/** The workspace's recent chats a spend read covers — the same page the Sessions tree lists. */
const SPEND_PAGE = 100;

/** The destination a chat binds into now, or undefined when signed out. */
export function chatAccountDestination(): EntityDestination | undefined {
  const tenantId = workspaceTenantId();
  if (tenantId === undefined) return undefined;
  let platformInstance: string;
  try {
    platformInstance = new URL(getBaseUrl()).origin;
  } catch {
    return undefined;
  }
  return { kind: "bound", platformInstance, tenantId: String(tenantId) };
}

/** A bind is a connected feature; a policy that cannot be read is a refusal. */
function bindAllowed(): boolean {
  try {
    return platformPolicy().allows("connected-feature") === true;
  } catch {
    return false;
  }
}

export function chatBindingPort(secrets: vscode.SecretStorage): ChatBindingPort {
  return {
    destination: chatAccountDestination,
    allowed: bindAllowed,
    createServerChat: (input) => createBrainChat(secrets, input),
  };
}

/** Cached per workspace for a short window: a turn's usage lands just after it settles,
 *  and the panel re-reads its chat list then anyway. */
const spendCache = ttlCache<number, ReadonlyMap<number, SpendSavingsSummary>>(30_000);

/** Drop the cached platform spend — after a sync pass put usage on the platform. */
export function invalidateServerChatSpend(): void {
  spendCache.invalidate();
}

/** The platform's spend for the bound chats a list shows. Rejects when it cannot be read,
 *  so the caller keeps its own estimate rather than showing nothing. */
export function serverChatSpend(secrets: vscode.SecretStorage) {
  // One page answers every id a list asks about, so the ids themselves are not sent.
  return async (_serverIds: readonly number[]): Promise<ReadonlyMap<number, SpendSavingsSummary>> => {
    const tenantId = workspaceTenantId();
    if (tenantId === undefined || !bindAllowed()) throw new Error("chat_spend_unavailable");
    const hit = spendCache.get(tenantId)?.value;
    // A chat older than the page is simply absent: its figure stays the device's own.
    if (hit) return hit;
    const chats = await listBrainChats(secrets, SPEND_PAGE);
    if (chats.length === 0) throw new Error("chat_spend_unavailable");
    const byId = new Map<number, SpendSavingsSummary>();
    for (const chat of chats) if (chat.spend) byId.set(chat.id, chat.spend);
    // A bound chat the page holds with no usage yet is spend-free, not unknown.
    for (const chat of chats) if (!chat.spend) byId.set(chat.id, EMPTY_SPEND);
    spendCache.set(tenantId, byId);
    return byId;
  };
}

const EMPTY_SPEND: SpendSavingsSummary = {
  spend: { platformUsd: 0, yourKeyUsd: 0, totalUsd: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, totalTokens: 0, unpricedTokens: 0, requests: 0 },
  saved: { measuredUsd: 0, estimatedUsd: 0, netUsd: 0, tokensSaved: 0, bySource: [] },
  savedPct: null,
};

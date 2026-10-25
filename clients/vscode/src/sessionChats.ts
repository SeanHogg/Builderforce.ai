/**
 * The Sessions tree lists the ACCOUNT's chats, by server id; the panel keys chats by
 * their LOCAL view key (PRD 36 — a local id never leaves the machine, and a server id
 * is never a local key). This is the one translation between the two, so a tree action
 * acts on the chat it names.
 */

import * as vscode from "vscode";
import type { LocalChatIdentity } from "@seanhogg/builderforce-brain-embedded";
import { getCurrentUserId } from "./bfApi";
import { getWebBaseUrl } from "./gateway";
import { localBrainApplication } from "./localFirstStore";

/** What the tree knows about the server chat it opens. */
export interface SessionChat {
  title: string;
  projectId: number | null;
  /** The chat's owner — only the owner's own chat is continued in the editor. */
  ownerId?: string | null;
}

/** The local chat bound to a server chat, or undefined when this machine has none. */
export function localChatOf(ctx: vscode.ExtensionContext, serverId: number): Promise<number | undefined> {
  return localBrainApplication(ctx).identity.localIdFor(serverId);
}

/** Each LOCAL chat's bound server chat id; unbound chats are left out. */
export async function boundServerIds(identity: LocalChatIdentity, localIds: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  await Promise.all([...new Set(localIds)].map(async (localId) => {
    const serverId = await identity.serverIdFor(localId);
    if (serverId !== undefined) out.set(localId, serverId);
  }));
  return out;
}

/** Opens of one server chat in flight — a double-click makes one local copy, not two. */
const opening = new Map<number, Promise<number | undefined>>();

/**
 * The local chat to open for a server chat: its bound copy, else a new local chat bound
 * to it, so the conversation continues on that server chat (its tickets, usage and
 * memory) instead of on whichever local chat happens to share its number. Undefined when
 * the editor must not continue it: a chat someone else owns (shared or member access —
 * binding to it would put this person's runs, spend and memory on a colleague's chat),
 * or no account to bind into.
 */
export function openableLocalChat(ctx: vscode.ExtensionContext, serverId: number, chat: SessionChat): Promise<number | undefined> {
  const running = opening.get(serverId);
  if (running) return running;
  const next = resolveLocalChat(ctx, serverId, chat).finally(() => opening.delete(serverId));
  opening.set(serverId, next);
  return next;
}

async function resolveLocalChat(ctx: vscode.ExtensionContext, serverId: number, chat: SessionChat): Promise<number | undefined> {
  const existing = await localChatOf(ctx, serverId);
  if (existing !== undefined) return existing;
  const userId = await getCurrentUserId(ctx.secrets);
  if (!userId || !chat.ownerId || chat.ownerId !== userId) return undefined;
  const local = localBrainApplication(ctx);
  const created = await local.persistence.createChat({ title: chat.title, projectId: chat.projectId });
  if (!(await local.identity.adopt(created.id, serverId))) {
    // Signed out between the tree's read and now: nothing to continue it on.
    await local.persistence.deleteChat(created.id);
    return undefined;
  }
  return created.id;
}

/** A chat the editor does not continue opens where its owner shares it: on the web. */
export function openServerChatOnWeb(serverId: number): Thenable<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/brainstorm?chat=${serverId}`));
}

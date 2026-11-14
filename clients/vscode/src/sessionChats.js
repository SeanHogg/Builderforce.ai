/**
 * The Sessions tree lists the ACCOUNT's chats, by server id; the panel keys chats by
 * their LOCAL view key (PRD 36 — a local id never leaves the machine, and a server id
 * is never a local key). This is the one translation between the two, so a tree action
 * acts on the chat it names.
 */
import * as vscode from "vscode";
import { getCurrentUserId } from "./bfApi";
import { activeEntityScope } from "./chatAccount";
import { getWebBaseUrl } from "./gateway";
import { localBrainApplication } from "./localFirstStore";
/** The local chat bound to a server chat in the active account, or undefined when this machine has none. */
export function localChatOf(ctx, serverId) {
    return localBrainApplication(ctx).identity.localIdFor(serverId, activeEntityScope());
}
/** Each LOCAL chat's bound server chat id; unbound chats are left out. */
export async function boundServerIds(identity, localIds) {
    const out = new Map();
    await Promise.all([...new Set(localIds)].map(async (localId) => {
        const serverId = await identity.serverIdFor(localId);
        if (serverId !== undefined)
            out.set(localId, serverId);
    }));
    return out;
}
/** Opens of one server chat in flight — a double-click makes one local copy, not two. */
const opening = new Map();
/**
 * The local chat to open for a server chat: its bound copy, else a new local chat bound
 * to it, so the conversation continues on that server chat (its tickets, usage and
 * memory) instead of on whichever local chat happens to share its number. Undefined when
 * the editor must not continue it: a chat someone else owns (shared or member access —
 * binding to it would put this person's runs, spend and memory on a colleague's chat),
 * or no account to bind into.
 */
export function openableLocalChat(ctx, serverId, chat) {
    const running = opening.get(serverId);
    if (running)
        return running;
    const next = resolveLocalChat(ctx, serverId, chat).finally(() => opening.delete(serverId));
    opening.set(serverId, next);
    return next;
}
async function resolveLocalChat(ctx, serverId, chat) {
    const existing = await localChatOf(ctx, serverId);
    if (existing !== undefined)
        return existing;
    const userId = await getCurrentUserId(ctx.secrets);
    if (!userId || !chat.ownerId || chat.ownerId !== userId)
        return undefined;
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
export function openServerChatOnWeb(serverId) {
    return vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/brainstorm?chat=${serverId}`));
}
//# sourceMappingURL=sessionChats.js.map
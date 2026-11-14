import { authed, authedRaw } from "./transport";
/**
 * The tenant's agent pool (workforce owned/purchased + registered agents), so a
 * chat's participant refs can be shown as names/initials. Stable tenant data —
 * the caller should fetch once and cache. Degrades to [] when signed out.
 */
export async function listAgentPool(secrets) {
    try {
        const [mine, purchased, registered] = await Promise.all([
            authed(secrets, '/api/workforce/agents/mine').catch(() => undefined),
            authed(secrets, '/api/workforce/agents/purchased').catch(() => undefined),
            authed(secrets, '/api/agents').catch(() => undefined),
        ]);
        const byRef = new Map();
        for (const a of [...(mine ?? []), ...(purchased ?? [])])
            byRef.set(String(a.id), a.name);
        for (const a of registered ?? [])
            if (a.isActive !== false)
                byRef.set(String(a.id), a.name);
        return [...byRef.entries()].map(([ref, name]) => ({ ref, name }));
    }
    catch {
        return [];
    }
}
/**
 * List the tenant's Brain conversations (GET /api/brain/chats) for the Sessions
 * sidebar — the SAME conversations the webview's `/api/brain` persistence loads, so
 * the sidebar, the in-panel switcher and the web app all show one unified history.
 * Degrades to [] when signed out / unreachable.
 */
export async function listBrainChats(secrets, limit = 50) {
    try {
        const r = await authed(secrets, `/api/brain/chats?limit=${limit}`);
        return r?.chats ?? [];
    }
    catch {
        return [];
    }
}
/**
 * Create a Brain conversation (POST /api/brain/chats) and return its id — the BIND of a
 * local chat (PRD 36, `chatAccount.ts`): a title and a project, never the transcript.
 * Returns null when signed out / unreachable (the chat then stays local).
 */
export async function createBrainChat(secrets, input) {
    try {
        const r = await authed(secrets, `/api/brain/chats`, {
            method: "POST",
            body: JSON.stringify({ title: input.title, projectId: input.projectId ?? null }),
        });
        return typeof r?.id === "number" ? r.id : null;
    }
    catch {
        return null;
    }
}
/** Rename a Brain conversation (PATCH /api/brain/chats/:id). */
export async function renameBrainChat(secrets, id, title) {
    await authed(secrets, `/api/brain/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}
/** Delete a Brain conversation (DELETE /api/brain/chats/:id). */
export async function deleteBrainChat(secrets, id) {
    await authed(secrets, `/api/brain/chats/${id}`, { method: "DELETE" });
}
/**
 * Adopt a project onto a Brain chat (PATCH /api/brain/chats/:id) — used by the native
 * participant's self-heal (`nativeChatProject.ts`): when the chat it runs on has no
 * project but the IDE has one SELECTED, bind it so the NEXT turn trains that project's
 * Evermind (parity with the webview's adopt-on-open — see `adoptedProjectRef` in
 * `webview/src/chat/useChatMemory.ts`). Both are gated on the IDE having a project
 * SELECTED: with no selection there is nothing to adopt and the chat stays global by
 * design.
 *
 * Never throws; answers whether the server took the bind, so the caller can release its
 * one-shot guard on a failure and retry on a later turn.
 */
export async function updateBrainChatProject(secrets, chatId, projectId) {
    try {
        const r = await authedRaw(secrets, `/api/brain/chats/${chatId}`, {
            method: "PATCH",
            body: JSON.stringify({ projectId }),
        });
        return r.status >= 200 && r.status < 300;
    }
    catch {
        return false; // signed out or unreachable — the chat stays unscoped until next time
    }
}
//# sourceMappingURL=brainChats.js.map
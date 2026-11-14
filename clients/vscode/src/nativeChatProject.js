/**
 * The native participant's half of the chat→project self-heal.
 *
 * The server's chat→Evermind learn gate keys on the SERVER chat's project, and a local
 * chat (PRD 36) is bound to a server chat once, with whatever project it had then. A chat
 * opened before a project was selected therefore runs unattached and trains nothing,
 * while the Evermind panel shows the selected project as connected. The webview adopts
 * the IDE's project onto an open chat (`adoptedProjectRef` in
 * `webview/src/chat/useChatMemory.ts`); this does the same for chats the participant
 * runs, using the SAME decision (`adoptChatProject`) with this surface's two writes: the
 * bound server chat and the local record.
 */
import { adoptChatProject } from "../webview/src/adoptChatProject";
/**
 * A one-shot-per-chat adopter. A chat is tried at most once; only a FAILED attempt is
 * released, so a transient failure is retried on a later turn and a settled one never is.
 * Binds the server chat first and the local record after, so the local record never
 * claims a project the server did not take.
 */
export function createNativeProjectAdopter() {
    const attempted = new Set();
    return async ({ persistence, bindServerProject, chatId, serverChatId, projectId }) => {
        if (projectId == null)
            return "no-project";
        if (attempted.has(chatId))
            return "already-attempted";
        attempted.add(chatId);
        const outcome = await adoptChatProject({
            getChat: (id) => persistence.getChat(id),
            updateChat: async (id, body) => {
                if (serverChatId != null && !(await bindServerProject(serverChatId, body.projectId))) {
                    throw new Error("server chat project not bound");
                }
                return persistence.updateChat(id, body);
            },
        }, chatId, projectId);
        if (outcome === "failed")
            attempted.delete(chatId);
        return outcome;
    };
}
//# sourceMappingURL=nativeChatProject.js.map
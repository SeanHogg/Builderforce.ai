/**
 * Adopt `projectId` onto `chatId` when — and only when — the chat has no project.
 *
 * Never re-points a chat that is deliberately scoped elsewhere, and never invents a
 * project when the IDE has none selected. Returns the outcome so the caller can decide
 * whether to reload its list ('adopted') or release its one-shot guard ('failed').
 */
export async function adoptChatProject(deps, chatId, projectId) {
    if (chatId == null || projectId == null)
        return 'no-project';
    try {
        const chat = await deps.getChat(chatId);
        if (chat.projectId != null)
            return 'already-scoped';
        await deps.updateChat(chatId, { projectId });
        return 'adopted';
    }
    catch {
        return 'failed';
    }
}
//# sourceMappingURL=adoptChatProject.js.map
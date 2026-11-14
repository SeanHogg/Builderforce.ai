import { authed } from "./transport";
/** Create a durable unified Canvas session from the editor. */
export async function createCreationSession(secrets, prompt) {
    const result = await authed(secrets, "/api/creation-sessions", {
        method: "POST",
        body: JSON.stringify({ title: prompt.trim().slice(0, 80) || "Untitled session", initialPrompt: prompt.trim() }),
    });
    if (!result?.session)
        throw new Error("not signed in");
    return result.session;
}
export async function listCreationSessions(secrets) {
    const result = await authed(secrets, "/api/creation-sessions?limit=50");
    return result?.sessions ?? [];
}
//# sourceMappingURL=creationSessions.js.map
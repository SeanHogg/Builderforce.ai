import { getSessionTabMode } from "./gateway";
import { BuilderForcePanel } from "./builderforcePanel";
import { revealChatView } from "./chatView";
/**
 * THE way into the workspace — every "open a chat / open a board" entry point calls
 * this, so where a conversation lands is decided once.
 *
 * - A CHAT in the default `reuse` mode goes to the agent chat area (the secondary-
 *   sidebar view, beside Chat / Claude Code / Codex): one chat surface, one place.
 * - A BOARD needs the editor's width, and `perSession` mode asked for one editor tab
 *   per conversation — both go to {@link BuilderForcePanel}.
 */
export async function openWorkspace(ctx, intent, opts) {
    const surface = opts?.surface ?? "chat";
    if (surface === "chat" && !opts?.sessionId && getSessionTabMode() === "reuse") {
        if (await revealChatView(intent))
            return;
    }
    await BuilderForcePanel.open(ctx, intent, opts);
}
//# sourceMappingURL=openWorkspace.js.map
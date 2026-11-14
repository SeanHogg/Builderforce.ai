import { getSessionTabMode } from "./gateway";
import { editorChatState, sessionTabIcon, sessionTabPrefix } from "./attention";
import { WebviewPanelBase } from "./webviewShared";
import { workspaceCanvasSession } from "./workspaceSession";
import { WorkspaceSurface } from "./workspaceSurface";
/**
 * The workspace in an EDITOR TAB — the board and the chat at full width. Everything
 * the webview does is the host-agnostic {@link WorkspaceSurface} (the same one the
 * secondary-sidebar chat view hosts); this class owns only what is tab-specific: the
 * reuse / per-session tab registry and painting each tab with its chat's live status.
 */
export class BuilderForcePanel extends WebviewPanelBase {
    mode;
    /** The single reused panel (`sessionTabs:reuse` — the default). */
    static reused;
    /** `sessionTabs:perSession`: one panel per chat id, so sessions are switchable tabs. */
    static byChat = new Map();
    /** perSession panels for a chat that has no server id yet (a 'new'/'seed' intent);
     *  each re-keys itself into {@link byChat} once the webview reports its chat. */
    static unassigned = new Set();
    /**
     * Reveal the workspace panel, at the surface the entry asked for.
     *
     * `builderforce.openChat` asks for `chat` and `builderforce.openCreateCanvas` asks
     * for `graph`; both land on the SAME panel, because a chat and a canvas are the
     * same board read two ways (`frontend/src/lib/canvasSurfaces.ts`). An already-open
     * panel is switched rather than duplicated — opening your chat while your board is
     * up must not leave you with two tabs holding one session.
     *
     * In `reuse` mode one panel is kept and the intent switches the conversation inside
     * it. In `perSession` mode each session gets its own tab: focusing a session that is
     * already open reveals ITS tab rather than stealing another one.
     */
    static async open(ctx, intent, opts) {
        const mode = getSessionTabMode();
        const surface = opts?.surface ?? "chat";
        const session = await workspaceCanvasSession(ctx, opts?.sessionId);
        if (mode === "reuse") {
            if (BuilderForcePanel.reused) {
                BuilderForcePanel.reused.panel.reveal();
                BuilderForcePanel.reused.surface.switchTo(surface, session);
                if (intent)
                    BuilderForcePanel.reused.surface.sendIntent(intent);
                return;
            }
            BuilderForcePanel.reused = new BuilderForcePanel(ctx, intent, mode, surface, session);
            return;
        }
        // perSession: an already-open session just comes forward — never duplicated, and
        // never switched out from under another tab.
        if (intent?.kind === "focus" && intent.chatId != null) {
            const open = BuilderForcePanel.byChat.get(intent.chatId);
            if (open) {
                open.panel.reveal();
                return;
            }
        }
        const panel = new BuilderForcePanel(ctx, intent, mode, surface, session);
        if (intent?.kind === "focus" && intent.chatId != null) {
            panel.ownChatId = intent.chatId;
            BuilderForcePanel.byChat.set(intent.chatId, panel);
            panel.applyTabStatus();
        }
        else {
            // 'new'/'seed'/'task' — the chat id only exists once the webview creates it.
            BuilderForcePanel.unassigned.add(panel);
        }
    }
    /**
     * Repaint every per-session tab's live status. Called from the SAME handlers that
     * already repaint the trees on an attention change, so tabs ride the one existing
     * poller + local-run overlay — no second timer, no extra fetch.
     */
    static refreshTabStatus() {
        for (const panel of BuilderForcePanel.byChat.values())
            panel.applyTabStatus();
        for (const panel of BuilderForcePanel.unassigned)
            panel.applyTabStatus();
    }
    surface;
    /** The chat this panel is bound to (perSession); undefined until the webview reports one. */
    ownChatId;
    /** The bound chat's title — the per-session tab's label. */
    chatTitle = "";
    constructor(ctx, intent, mode, surface, session) {
        super(ctx, { viewType: "builderforce.workspace", title: "BuilderForce", htmlTitle: "BuilderForce" });
        this.mode = mode;
        // Messages cannot arrive before this runs: the webview loads asynchronously after
        // the constructor returns, so `onMessage` always finds the surface.
        this.surface = new WorkspaceSurface(ctx, { webview: this.panel.webview, owner: this.panel, onSessionMeta: (chatId, title) => this.bindSession(chatId, title) }, session, surface, intent);
    }
    onMessage(msg) {
        return this.surface.handle(msg);
    }
    /**
     * Bind this panel to the chat its webview is showing. In perSession mode the panel
     * re-keys itself in the registry — this is how a tab opened for a BRAND-NEW chat
     * (which has no id until the webview creates it server-side) becomes switchable and
     * starts tracking its own live status. In reuse mode only the title is recorded.
     */
    bindSession(chatId, title) {
        if (title !== undefined)
            this.chatTitle = title;
        if (this.mode === "perSession" && chatId !== this.ownChatId) {
            if (this.ownChatId != null && BuilderForcePanel.byChat.get(this.ownChatId) === this) {
                BuilderForcePanel.byChat.delete(this.ownChatId);
            }
            this.ownChatId = chatId;
            if (chatId != null) {
                // Another tab already holds this chat (e.g. the webview navigated onto it) —
                // it loses the key so exactly one tab owns a session.
                BuilderForcePanel.byChat.set(chatId, this);
                BuilderForcePanel.unassigned.delete(this);
            }
            else {
                BuilderForcePanel.unassigned.add(this);
            }
        }
        this.applyTabStatus();
    }
    /**
     * Paint this tab with its chat's title + live status, so a user juggling sessions
     * sees which one is working and which one needs an answer WITHOUT opening it —
     * the same run state the Sessions row shows ({@link editorChatState}, by local id).
     * Reuse mode keeps the product title (its one tab is not a single session).
     */
    applyTabStatus() {
        if (this.mode !== "perSession")
            return;
        // The panel's chat is a LOCAL id: its own runs, not the server map (PRD 36).
        const state = this.ownChatId != null ? editorChatState(this.ownChatId) : undefined;
        const name = this.chatTitle.trim() || "BuilderForce";
        this.panel.title = `${sessionTabPrefix(state)}${name}`;
        this.panel.iconPath = sessionTabIcon(this.ctx.extensionUri, state);
    }
    onDispose() {
        this.surface.dispose();
        if (BuilderForcePanel.reused === this)
            BuilderForcePanel.reused = undefined;
        if (this.ownChatId != null && BuilderForcePanel.byChat.get(this.ownChatId) === this) {
            BuilderForcePanel.byChat.delete(this.ownChatId);
        }
        BuilderForcePanel.unassigned.delete(this);
    }
}
//# sourceMappingURL=builderforcePanel.js.map
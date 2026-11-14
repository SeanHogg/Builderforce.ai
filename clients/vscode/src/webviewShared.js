import * as vscode from "vscode";
import { getBaseUrl } from "./gateway";
import { makeNonce, renderBundleShell } from "./webviewBundleShell";
import { handleSharedHostMessage, postToWebview, respondToWebview } from "./webviewHostBridge";
// Re-exported for the board panel, which builds its own (non-bundle) shell.
export { makeNonce };
/**
 * The shared HTML shell for the bundled-React webview panels (the workspace —
 * board and chat — plus Project 360 and the project pages). Identical CSP
 * (`default-src 'none'`, a nonce'd module script, and the gateway origin allowed in
 * `connect-src` with an `https:` fallback) and asset wiring across all of them, so
 * only the `<title>` differs.
 *
 * There is ONE bundle now. `assetDir` used to choose between a chat bundle and a
 * canvas bundle; the two merged when chat became a SURFACE of the board rather than
 * a place of its own, so there is nothing left to choose between. The capabilities
 * the board needs are therefore always granted: any panel can now BE the board.
 */
export function renderWebviewHtml(webview, ctx, opts) {
    // The gateway/API origin the app fetches directly; allowed in connect-src.
    let apiOrigin = "https://api.builderforce.ai";
    try {
        apiOrigin = new URL(getBaseUrl()).origin;
    }
    catch {
        /* keep default */
    }
    return renderBundleShell({
        cspSource: webview.cspSource,
        nonce: makeNonce(),
        apiOrigin,
        assetUrl: (f) => webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "media", "webview", f)).toString(),
        title: opts.title,
        bootLabel: vscode.l10n.t("Connecting…"),
        // The root error fallback's copy: a crash can come before (or take down) the label bundle.
        bootStrings: {
            title: vscode.l10n.t("BuilderForce hit an error"),
            body: vscode.l10n.t("This panel stopped drawing. The error was sent to the BuilderForce output log."),
            reload: vscode.l10n.t("Reload panel"),
            copy: vscode.l10n.t("Copy details"),
        },
    });
}
/**
 * Shared lifecycle for the bundled-React webview panels. Creates the panel with the
 * standard options, installs the HTML shell, pumps messages (handling the two
 * host-owned cases every panel shares — `token.refresh` and `signin` — centrally),
 * and tears down on dispose. Subclasses supply only their unique message handling
 * ({@link onMessage}) and registry cleanup ({@link onDispose}); those that re-pull on
 * refocus opt in via {@link onDidBecomeVisible}.
 */
export class WebviewPanelBase {
    ctx;
    panel;
    disposables = [];
    htmlTitle;
    constructor(ctx, init) {
        this.ctx = ctx;
        this.htmlTitle = init.htmlTitle;
        this.panel = vscode.window.createWebviewPanel(init.viewType, init.title, init.show ?? vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: init.localResourceRoots ?? [vscode.Uri.joinPath(ctx.extensionUri, "media")],
        });
        this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icon.png");
        // Listener before html — same race as EvermindViewProvider: the bundle posts
        // `ready` at module load, and a dropped ready leaves the panel on the sign-in wall.
        this.panel.webview.onDidReceiveMessage((m) => void this.dispatchMessage(m), undefined, this.disposables);
        this.panel.webview.html = this.renderHtml(this.panel.webview);
        this.panel.onDidDispose(() => this.teardown(), undefined, this.disposables);
    }
    /** The panel's HTML. Defaults to the shared bundled-React shell (Brain / Project 360 /
     *  project pages); panels with a bespoke self-contained UI — the native Kanban board —
     *  override this to supply their own document while still sharing the lifecycle above. */
    renderHtml(webview) {
        return renderWebviewHtml(webview, this.ctx, { title: this.htmlTitle });
    }
    /** Re-pull the screen when the panel regains focus (Project 360 / project pages). */
    onDidBecomeVisible(cb) {
        this.panel.onDidChangeViewState((e) => {
            if (e.webviewPanel.visible)
                cb();
        }, undefined, this.disposables);
    }
    /** Route the shared, host-owned cases; delegate everything else to the subclass.
     *  The shared set lives in `webviewHostBridge` because the Evermind SIDEBAR VIEW
     *  answers the same messages and cannot extend this panel base. */
    async dispatchMessage(msg) {
        if (await handleSharedHostMessage(this.ctx, this.panel.webview, msg, this.panel))
            return;
        await this.onMessage(msg);
    }
    /** Fire-and-forget post to the webview. */
    post(msg) {
        postToWebview(this.panel.webview, msg, this.panel);
    }
    /** Reply to a webview `request` round-trip; a no-op without an id (fire-and-forget). */
    respond(id, ok, result, error) {
        respondToWebview(this.panel.webview, id, ok, result, error);
    }
    teardown() {
        this.onDispose();
        for (const d of this.disposables) {
            try {
                d.dispose();
            }
            catch {
                /* noop */
            }
        }
    }
}
//# sourceMappingURL=webviewShared.js.map
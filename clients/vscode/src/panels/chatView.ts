import * as vscode from "vscode";
import { renderWebviewHtml } from "./webviewShared";
import { handleSharedHostMessage } from "./webviewHostBridge";
import { reportExtensionError } from "../diagnostics/errorReporter";
import { workspaceCanvasSession } from "../workspace/workspaceSession";
import { WorkspaceSurface, type BrainInbound, type BrainIntent } from "../workspace/workspaceSurface";

/** The chat view in the SECONDARY sidebar — the agent chat area, beside Chat / Claude
 *  Code / Codex. Contributed under `viewsContainers.secondarySidebar`. */
const CHAT_VIEW_ID = "builderforce.chatView";
/** The same view in the BuilderForce activity-bar container, for editors that predate
 *  the secondary-sidebar contribution point. A view id can be contributed only once,
 *  so the fallback is a second id whose `when` is the inverse of the first. */
const CHAT_VIEW_FALLBACK_ID = "builderforce.chatViewSidebar";
/** Set when this editor cannot host a `secondarySidebar` view container. */
const NO_SECONDARY_SIDEBAR_CTX = "builderforce.doesNotSupportSecondarySidebar";

/** `viewsContainers.secondarySidebar` shipped in VS Code 1.106. */
function supportsSecondarySidebar(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 1 || (major === 1 && minor >= 106);
}

/**
 * BuilderForce in the editor's agent chat area. It hosts the SAME
 * {@link WorkspaceSurface} as the editor tab, opened at the chat surface, so a turn
 * typed here runs on the one host-owned run loop and shows up in Sessions like any
 * other — this is a second place to hold the conversation, not a second chat.
 */
class BuilderForceChatViewProvider implements vscode.WebviewViewProvider {
  /** The surface of the resolved view; undefined until VS Code first shows it. Resolves
   *  undefined when the view closed before the board lookup finished. */
  private surface?: Promise<WorkspaceSurface | undefined>;
  /** An intent that arrived before the view resolved — handed to the surface it creates. */
  private pendingIntent?: BrainIntent;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  /** Deliver an intent: to the live surface, or to the one the view is about to create.
   *  A lookup that ends with no surface (view closed, lookup failed) has already dropped
   *  itself from {@link surface}, so the re-delivery goes to the next view. */
  deliver(intent: BrainIntent | undefined): void {
    if (!intent) return;
    if (this.surface) void this.surface.then((s) => (s ? s.sendIntent(intent) : this.deliver(intent)));
    else this.pendingIntent = intent;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    // A closed view THROWS on `webview` / `description`; async continuations (a late
    // session meta, a message in flight) check this instead of touching it.
    let disposed = false;
    // Captured once: `postMessage` on this object just resolves false after dispose.
    const webview = view.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    // The board lookup can be a network round trip; the shell boots meanwhile and its
    // messages wait on the surface rather than the view waiting on the lookup. A view
    // closed before it answers, or a lookup that fails, gets no surface: the promise
    // resolves undefined (never rejects) and any pending intent waits for the next view.
    const surface: Promise<WorkspaceSurface | undefined> = workspaceCanvasSession(this.ctx)
      .then((session) => {
        if (disposed) return undefined;
        const intent = this.takePendingIntent();
        try {
          return new WorkspaceSurface(
            this.ctx,
            {
              webview,
              owner: view,
              // A sidebar has no room for a board above the conversation: the board and the
              // run's changes open in the visualization panel, in the editor area beside it.
              boardBeside: true,
              // The view's title is the product; the conversation it holds goes beside it.
              onSessionMeta: (_chatId, title) => {
                if (disposed || title === undefined) return;
                view.description = title.trim() || undefined;
              },
            },
            session,
            "chat",
            intent,
          );
        } catch (error) {
          this.pendingIntent ??= intent;
          throw error;
        }
      })
      .catch((error: unknown) => {
        // Dropped from `this.surface` BEFORE anything chained on it runs, so `deliver`
        // re-routes to `pendingIntent` instead of looping on this dead lookup.
        if (this.surface === surface) this.surface = undefined;
        void reportExtensionError(error, { operation: "chatView.resolveSession" });
        if (!disposed) {
          void vscode.window.showWarningMessage(
            vscode.l10n.t("BuilderForce could not open the chat. Close and reopen the view to try again."),
          );
        }
        return undefined;
      });
    this.surface = surface;
    // Listener BEFORE html: the bundled app posts `ready` at module load, and a dropped
    // `ready` leaves the view on the sign-in wall (see EvermindViewProvider).
    const listener = webview.onDidReceiveMessage(async (m: BrainInbound) => {
      if (disposed) return;
      if (await handleSharedHostMessage(this.ctx, webview, m, view)) return;
      const live = await surface;
      if (live && !disposed) await live.handle(m);
    });
    webview.html = renderWebviewHtml(webview, this.ctx, { title: "BuilderForce" });
    // The visualization does NOT open with the chat view: it opens only on the header's
    // Visualize lever or the `builderforce.openVisualization` command — never on its own.
    // A token may have refreshed while the view was hidden.
    const visibility = view.onDidChangeVisibility(() => { if (view.visible) void surface.then((s) => s?.refresh()); });
    view.onDidDispose(() => {
      disposed = true;
      listener.dispose();
      visibility.dispose();
      if (this.surface === surface) this.surface = undefined;
      void surface.then((s) => s?.dispose());
    });
  }

  private takePendingIntent(): BrainIntent | undefined {
    const intent = this.pendingIntent;
    this.pendingIntent = undefined;
    return intent;
  }
}

let provider: BuilderForceChatViewProvider | undefined;
/** Which of the two view ids this editor shows. */
let activeViewId = CHAT_VIEW_ID;

/** Register the agent-chat-area view (and its activity-bar fallback on older editors). */
export function registerChatView(ctx: vscode.ExtensionContext): void {
  if (!supportsSecondarySidebar(vscode.version)) {
    activeViewId = CHAT_VIEW_FALLBACK_ID;
    void vscode.commands.executeCommand("setContext", NO_SECONDARY_SIDEBAR_CTX, true);
  }
  provider = new BuilderForceChatViewProvider(ctx);
  const options = { webviewOptions: { retainContextWhenHidden: true } };
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, options),
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_FALLBACK_ID, provider, options),
  );
}

/**
 * Bring the chat view forward and hand it `intent`. False when the view is not
 * registered (activation has not reached it), so the caller can fall back to a tab.
 */
export async function revealChatView(intent?: BrainIntent): Promise<boolean> {
  if (!provider) return false;
  provider.deliver(intent);
  // `<viewId>.focus` is generated by VS Code for every contributed view: it opens the
  // container (the secondary sidebar) and resolves the view if it never has been.
  await vscode.commands.executeCommand(`${activeViewId}.focus`);
  return true;
}

import * as vscode from "vscode";
import { renderWebviewHtml } from "./webviewShared";
import { handleSharedHostMessage } from "./webviewHostBridge";
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
  private surface?: WorkspaceSurface;
  /** An intent that arrived before the view resolved — handed to the surface it creates. */
  private pendingIntent?: BrainIntent;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  /** Deliver an intent to the current or next surface. */
  deliver(intent: BrainIntent | undefined): void {
    if (!intent) return;
    if (this.surface) this.surface.sendIntent(intent);
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
    // The Visualization panel resolves the board when opened. Chat can handle ready immediately.
    const surface = new WorkspaceSurface(
      this.ctx,
      {
        webview,
        owner: view,
        boardBeside: true,
        onSessionMeta: (_chatId, title) => {
          if (disposed || title === undefined) return;
          view.description = title.trim() || undefined;
        },
      },
      undefined,
      "chat",
      this.pendingIntent,
    );
    this.pendingIntent = undefined;
    this.surface = surface;
    // Listener BEFORE html: the bundled app posts `ready` at module load, and a dropped
    // `ready` leaves the view on the sign-in wall (see EvermindViewProvider).
    const listener = webview.onDidReceiveMessage(async (m: BrainInbound) => {
      if (disposed) return;
      if (await handleSharedHostMessage(this.ctx, webview, m, view)) return;
      if (!disposed) await surface.handle(m);
    });
    webview.html = renderWebviewHtml(webview, this.ctx, { title: "BuilderForce" });
    // The visualization does NOT open with the chat view: it opens only on the header's
    // Visualize lever or the `builderforce.openVisualization` command — never on its own.
    // A token may have refreshed while the view was hidden.
    const visibility = view.onDidChangeVisibility(() => { if (view.visible) surface.refresh(); });
    view.onDidDispose(() => {
      disposed = true;
      listener.dispose();
      visibility.dispose();
      if (this.surface === surface) this.surface = undefined;
      surface.dispose();
    });
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

import * as vscode from "vscode";
import { renderWebviewHtml } from "./webviewShared";
import { handleSharedHostMessage } from "./webviewHostBridge";
import { workspaceCanvasSession } from "./workspaceSession";
import { WorkspaceSurface, type BrainInbound, type BrainIntent } from "./workspaceSurface";

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
  /** The surface of the resolved view; undefined until VS Code first shows it. */
  private surface?: Promise<WorkspaceSurface>;
  /** An intent that arrived before the view resolved — handed to the surface it creates. */
  private pendingIntent?: BrainIntent;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  /** Deliver an intent: to the live surface, or to the one the view is about to create. */
  deliver(intent: BrainIntent | undefined): void {
    if (!intent) return;
    if (this.surface) void this.surface.then((s) => s.sendIntent(intent));
    else this.pendingIntent = intent;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    // The board lookup can be a network round trip; the shell boots meanwhile and its
    // messages wait on the surface rather than the view waiting on the lookup.
    const surface = workspaceCanvasSession(this.ctx).then((session) => new WorkspaceSurface(
      this.ctx,
      {
        webview: view.webview,
        owner: view,
        // A sidebar has no room for a board above the conversation: the board and the
        // run's changes open in the visualization panel, in the editor area beside it.
        boardBeside: true,
        // The view's title is the product; the conversation it holds goes beside it.
        onSessionMeta: (_chatId, title) => {
          if (title !== undefined) view.description = title.trim() || undefined;
        },
      },
      session,
      "chat",
      this.takePendingIntent(),
    ));
    this.surface = surface;
    // Listener BEFORE html: the bundled app posts `ready` at module load, and a dropped
    // `ready` leaves the view on the sign-in wall (see EvermindViewProvider).
    const listener = view.webview.onDidReceiveMessage(async (m: BrainInbound) => {
      if (await handleSharedHostMessage(this.ctx, view.webview, m, view)) return;
      await (await surface).handle(m);
    });
    view.webview.html = renderWebviewHtml(view.webview, this.ctx, { title: "BuilderForce" });
    // The visualization is the other half of this view, so it opens with it — once per
    // window; closing it is respected until the header's Visualize lever reopens it.
    if (!visualizationOpened) {
      visualizationOpened = true;
      void vscode.commands.executeCommand("builderforce.openVisualization");
    }
    // A token may have refreshed while the view was hidden.
    const visibility = view.onDidChangeVisibility(() => { if (view.visible) void surface.then((s) => s.refresh()); });
    view.onDidDispose(() => {
      listener.dispose();
      visibility.dispose();
      if (this.surface === surface) this.surface = undefined;
      void surface.then((s) => s.dispose());
    });
  }

  private takePendingIntent(): BrainIntent | undefined {
    const intent = this.pendingIntent;
    this.pendingIntent = undefined;
    return intent;
  }
}

let provider: BuilderForceChatViewProvider | undefined;
/** The visualization panel was opened alongside the chat view in this window. */
let visualizationOpened = false;
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

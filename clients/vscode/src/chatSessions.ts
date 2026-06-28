import * as vscode from "vscode";
import { createBuilderForceHandler } from "./chatParticipant";

const SESSION_TYPE = "builderforce";

/**
 * Registers BuilderForce as a dedicated chat-session tab (like CLAUDE CODE / CODEX),
 * reusing the same agent handler. This uses VS Code's PROPOSED chat-sessions API
 * (`chatSessionsProvider`), so it is feature-detected and accessed dynamically — it only
 * activates when VS Code is launched with `--enable-proposed-api builderforce.builderforce-ai`
 * on a compatible build. When the API is absent it logs once and no-ops, so the stable
 * sidebar + @builderforce participant are never affected.
 *
 * Returns a Disposable, or undefined when the proposed API isn't available.
 */
export function registerChatSessions(
  ctx: vscode.ExtensionContext,
  participant: vscode.ChatParticipant,
): vscode.Disposable | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatApi = vscode.chat as any;
  if (typeof chatApi.registerChatSessionContentProvider !== "function") {
    console.log(
      "[BuilderForce] Dedicated chat tab unavailable. Launch with " +
        "`--enable-proposed-api builderforce.builderforce-ai` on VS Code 1.125+ to enable it.",
    );
    return undefined;
  }

  const handler = createBuilderForceHandler(ctx);
  const disposables: vscode.Disposable[] = [];

  // 1) The session LIST (the "SESSIONS" panel). Two API shapes exist mid-migration —
  // prefer the controller, fall back to the item provider; both are best-effort.
  try {
    if (typeof chatApi.createChatSessionItemController === "function") {
      const controller = chatApi.createChatSessionItemController(SESSION_TYPE, () => {
        /* refresh handler — items are managed by VS Code's New Session action */
      });
      disposables.push(controller as vscode.Disposable);
    } else if (typeof chatApi.registerChatSessionItemProvider === "function") {
      const changed = new vscode.EventEmitter<void>();
      disposables.push(changed);
      disposables.push(
        chatApi.registerChatSessionItemProvider(SESSION_TYPE, {
          onDidChangeChatSessionItems: changed.event,
          provideChatSessionItems: () => [],
        }) as vscode.Disposable,
      );
    }
  } catch (e) {
    console.error("[BuilderForce] chat-session list registration failed:", e);
  }

  // 2) The session CONTENT (the actual chat in the tab) — bind the type to our agent.
  try {
    const contentProvider = {
      provideChatSessionContent: async (_resource: vscode.Uri) => ({
        history: [] as unknown[],
        requestHandler: handler,
      }),
    };
    disposables.push(
      chatApi.registerChatSessionContentProvider(
        SESSION_TYPE,
        contentProvider,
        participant,
      ) as vscode.Disposable,
    );
  } catch (e) {
    console.error("[BuilderForce] chat-session content registration failed:", e);
  }

  return disposables.length ? vscode.Disposable.from(...disposables) : undefined;
}

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
 * ## Decision: the two per-tab surfaces do NOT converge (recorded 2026-08-20)
 *
 * The open question was whether this and the stable `BrainWebview` per-session tabs
 * (`sessionTabs:perSession`) should collapse into one implementation if VS Code ever
 * promotes `chatSessionsProvider` to stable. They should not, and the reason is that they
 * were never two implementations of one thing:
 *
 *  - This file is a ~75-line REGISTRATION ADAPTER. It owns no chat logic: every turn is
 *    served by {@link createBuilderForceHandler}, the exact handler the stable
 *    `@builderforce` participant uses. There is no duplicated loop, tool wiring, model
 *    resolution or persistence here to converge — that consolidation already happened.
 *  - `BrainWebview` is a different SURFACE, not a second copy of this one. It carries what
 *    the native chat UI has no contract for: the Evermind console, the model picker, the
 *    creation canvas, per-chat project attachment, diagnostics capture. Retiring it to
 *    gain a native tab would delete features, not duplication.
 *
 * So promotion of the proposed API changes exactly one thing — the feature detection below
 * starts succeeding on stable builds — and nothing else. Keep both. This adapter stays
 * thin BY RULE: any behaviour that would need to live here belongs in the shared handler
 * instead, which is what keeps a second implementation from ever appearing.
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
